const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Security Fixes Verification", function () {
    let marketplace, marketplaceV2, erc721, owner, seller, buyer, maliciousUser;

    beforeEach(async function () {
        [owner, seller, buyer, maliciousUser] = await ethers.getSigners();

        // Deploy ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("Test", "TST", 10000, owner.address, 500);
        await erc721.waitForDeployment();

        // Deploy Marketplace
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(250, owner.address);
        await marketplace.waitForDeployment();

        // Deploy MarketplaceV2 (Upgradeable) with manual proxy
        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const implementation = await MarketplaceV2.deploy();
        await implementation.waitForDeployment();

        const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
        const initData = MarketplaceV2.interface.encodeFunctionData("initialize", [
            250,
            owner.address,
            owner.address
        ]);
        const proxy = await ERC1967Proxy.deploy(await implementation.getAddress(), initData);
        await proxy.waitForDeployment();

        marketplaceV2 = MarketplaceV2.attach(await proxy.getAddress());

        // Setup: Mint NFT to seller and approve marketplaces
        await erc721.mint(seller.address, "ipfs://test");
        await erc721.mint(seller.address, "ipfs://test2");
        await erc721.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await erc721.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);
    });

    describe("Flash Loan Protection (Listing-Level)", function () {
        it("Marketplace: Should prevent buying in the same block as listing", async function () {
            // Disable auto-mining to test same-block behavior
            await ethers.provider.send("evm_setAutomine", [false]);
            await ethers.provider.send("evm_setIntervalMining", [0]);

            // Create listing (tx is pending)
            const listTx = await marketplace.connect(seller).listERC721(await erc721.getAddress(), 0, ethers.parseEther("1"));

            // Buy listing (tx is pending)
            const buyTx = await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });

            // Mine both in one block
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("evm_setAutomine", [true]); // Re-enable

            // The buy transaction should have failed (SameBlockPurchase)
            const receipt = await ethers.provider.getTransactionReceipt(buyTx.hash);
            expect(receipt.status).to.equal(0);
        });

        it("Marketplace: Should allow buying in the next block", async function () {
            await ethers.provider.send("evm_setAutomine", [true]);
            await marketplace.connect(seller).listERC721(await erc721.getAddress(), 0, ethers.parseEther("1"));

            // Wait for it to be mined (default behavior of await tx) but just to be sure:
            await mine();

            await expect(marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") }))
                .to.not.be.reverted;
        });
    });

    describe("Payment DoS Protection (Pull Pattern)", function () {
        it("Marketplace: Should store funds in pendingWithdrawals instead of reverting if seller blocks", async function () {
            await ethers.provider.send("evm_setAutomine", [true]);
            const price = ethers.parseEther("1");
            await marketplace.connect(seller).listERC721(await erc721.getAddress(), 0, price);

            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

            await marketplace.connect(buyer).buy(0, { value: price });

            const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);

            // Balance shouldn't change immediately (Pull pattern)
            expect(sellerBalanceAfter).to.equal(sellerBalanceBefore);

            // Check pending withdrawals
            const platformFee = (price * 250n) / 10000n;
            const royalty = (price * 500n) / 10000n;
            const sellerAmount = price - platformFee - royalty;

            expect(await marketplace.pendingWithdrawals(seller.address)).to.equal(sellerAmount);
        });

        it("Marketplace: Seller can withdraw funds", async function () {
            await ethers.provider.send("evm_setAutomine", [true]);
            const price = ethers.parseEther("1");
            await marketplace.connect(seller).listERC721(await erc721.getAddress(), 0, price);
            await marketplace.connect(buyer).buy(0, { value: price });

            const initialBalance = await ethers.provider.getBalance(seller.address);

            await marketplace.connect(seller).withdrawFunds();

            const finalBalance = await ethers.provider.getBalance(seller.address);
            expect(finalBalance).to.be.gt(initialBalance);
        });
    });

    describe("Upgrade Timelock (MarketplaceV2)", function () {
        it("Should enforce upgrade delay", async function () {
            await ethers.provider.send("evm_setAutomine", [true]);
            const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
            const newImpl = await MarketplaceV2.deploy(); // Mock new impl

            // 1. Try to upgrade without scheduling
            await expect(marketplaceV2.upgradeToAndCall(await newImpl.getAddress(), "0x"))
                .to.be.revertedWithCustomError(marketplaceV2, "UpgradeNotScheduled");

            // 2. Schedule upgrade
            await marketplaceV2.scheduleUpgrade(await newImpl.getAddress());

            // 3. Try to upgrade immediately
            await expect(marketplaceV2.upgradeToAndCall(await newImpl.getAddress(), "0x"))
                .to.be.revertedWithCustomError(marketplaceV2, "UpgradeTooEarly");

            // 4. Wait
            await time.increase(172800); // 2 days

            // 5. Upgrade should succeed
            await expect(marketplaceV2.upgradeToAndCall(await newImpl.getAddress(), "0x"))
                .to.not.be.reverted;
        });
    });
});
