const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarketplaceV2", function () {
    let marketplaceV2;
    let erc721;
    let erc1155;
    let mockToken;
    let owner;
    let admin;
    let seller;
    let buyer;
    let royaltyReceiver;

    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;

    beforeEach(async function () {
        [owner, admin, seller, buyer, royaltyReceiver] = await ethers.getSigners();

        // Deploy ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy(
            "TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE
        );

        // Deploy ERC1155
        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        erc1155 = await ERC1155NFT.deploy(
            "TestMulti", "TMT", "ipfs://base/", royaltyReceiver.address, ROYALTY_FEE
        );

        // Deploy mock ERC20 token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("MockToken", "MTK", ethers.parseEther("1000000"));
        await mockToken.transfer(buyer.address, ethers.parseEther("10000"));

        // Deploy MarketplaceV2 implementation
        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const implementation = await MarketplaceV2.deploy();
        await implementation.waitForDeployment();

        // Deploy ERC1967Proxy
        const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
        const initData = MarketplaceV2.interface.encodeFunctionData("initialize", [
            PLATFORM_FEE,
            owner.address,
            admin.address
        ]);
        const proxy = await ERC1967Proxy.deploy(
            await implementation.getAddress(),
            initData
        );
        await proxy.waitForDeployment();

        // Attach MarketplaceV2 interface to proxy
        marketplaceV2 = MarketplaceV2.attach(await proxy.getAddress());

        // Mint NFTs to seller
        await erc721.mint(seller.address, "ipfs://token/0");
        await erc721.mint(seller.address, "ipfs://token/1");
        await erc1155.mint(seller.address, 100, "ipfs://multi/0");

        // Approve marketplace
        await erc721.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);
        await erc1155.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);

        // Whitelist mock token for ERC20 payments
        await marketplaceV2.connect(admin).setAcceptedToken(await mockToken.getAddress(), true);
    });

    describe("Initialization", function () {
        it("Should set correct platform fee", async function () {
            expect(await marketplaceV2.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await marketplaceV2.feeRecipient()).to.equal(owner.address);
        });

        it("Should grant admin role", async function () {
            const ADMIN_ROLE = await marketplaceV2.ADMIN_ROLE();
            expect(await marketplaceV2.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
        });

        it("Should grant all roles to admin", async function () {
            const roles = [
                await marketplaceV2.ADMIN_ROLE(),
                await marketplaceV2.PAUSER_ROLE(),
                await marketplaceV2.FEE_MANAGER_ROLE(),
                await marketplaceV2.UPGRADER_ROLE()
            ];

            for (const role of roles) {
                expect(await marketplaceV2.hasRole(role, admin.address)).to.equal(true);
            }
        });

        it("Should return correct version", async function () {
            expect(await marketplaceV2.version()).to.equal("2.1.0");
        });

        it("Should start with zero listings", async function () {
            expect(await marketplaceV2.getTotalListings()).to.equal(0);
        });
    });

    describe("Role-Based Access Control", function () {
        it("Should allow FEE_MANAGER to update platform fee", async function () {
            await marketplaceV2.connect(admin).setPlatformFee(500);
            expect(await marketplaceV2.platformFee()).to.equal(500);
        });

        it("Should reject fee update from non-FEE_MANAGER", async function () {
            await expect(
                marketplaceV2.connect(seller).setPlatformFee(500)
            ).to.be.reverted;
        });

        it("Should allow ADMIN to update fee recipient", async function () {
            await marketplaceV2.connect(admin).setFeeRecipient(buyer.address);
            expect(await marketplaceV2.feeRecipient()).to.equal(buyer.address);
        });

        it("Should allow PAUSER to pause contract", async function () {
            await marketplaceV2.connect(admin).pause();
            expect(await marketplaceV2.paused()).to.equal(true);
        });

        it("Should allow PAUSER to unpause contract", async function () {
            await marketplaceV2.connect(admin).pause();
            await marketplaceV2.connect(admin).unpause();
            expect(await marketplaceV2.paused()).to.equal(false);
        });

        it("Should allow ADMIN to whitelist tokens", async function () {
            const newToken = ethers.Wallet.createRandom().address;
            await marketplaceV2.connect(admin).setAcceptedToken(newToken, true);
            expect(await marketplaceV2.acceptedTokens(newToken)).to.equal(true);
        });
    });

    describe("ERC721 Listing with ETH", function () {
        it("Should list an ERC721 token with ETH payment", async function () {
            const price = ethers.parseEther("1");

            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, price, ethers.ZeroAddress
            );

            const listing = await marketplaceV2.getListing(0);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.price).to.equal(price);
            expect(listing.paymentToken).to.equal(ethers.ZeroAddress);
        });

        it("Should transfer NFT to marketplace on listing", async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
            );

            expect(await erc721.ownerOf(0)).to.equal(await marketplaceV2.getAddress());
        });

        it("Should fail to list with zero price", async function () {
            await expect(
                marketplaceV2.connect(seller).listERC721(
                    await erc721.getAddress(), 0, 0, ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(marketplaceV2, "InvalidPrice");
        });

        it("Should fail to list token not owned", async function () {
            await expect(
                marketplaceV2.connect(buyer).listERC721(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(marketplaceV2, "NotTokenOwner");
        });
    });

    describe("ERC721 Listing with ERC20", function () {
        it("Should list an ERC721 token with ERC20 payment", async function () {
            const price = ethers.parseEther("100");

            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, price, await mockToken.getAddress()
            );

            const listing = await marketplaceV2.getListing(0);
            expect(listing.paymentToken).to.equal(await mockToken.getAddress());
        });

        it("Should fail to list with non-whitelisted token", async function () {
            const randomToken = ethers.Wallet.createRandom().address;

            await expect(
                marketplaceV2.connect(seller).listERC721(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), randomToken
                )
            ).to.be.revertedWithCustomError(marketplaceV2, "TokenNotAccepted");
        });
    });

    describe("Buying with ETH", function () {
        beforeEach(async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
            );
        });

        it("Should allow buying at listed price", async function () {
            await marketplaceV2.connect(buyer).buy(0, { value: ethers.parseEther("1") });

            expect(await erc721.ownerOf(0)).to.equal(buyer.address);
        });

        it("Should distribute fees correctly (Pull Pattern)", async function () {
            const price = ethers.parseEther("1");
            const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
            const royaltyAmount = (price * BigInt(ROYALTY_FEE)) / 10000n;
            const sellerAmount = price - platformAmount - royaltyAmount;

            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

            await marketplaceV2.connect(buyer).buy(0, { value: price });

            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

            // Platform fee is direct transfer
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(platformAmount);

            // Seller and Royalty are pull payments
            expect(await marketplaceV2.pendingWithdrawals(seller.address)).to.equal(sellerAmount);
            expect(await marketplaceV2.pendingWithdrawals(royaltyReceiver.address)).to.equal(royaltyAmount);
        });

        it("Should refund excess payment", async function () {
            const price = ethers.parseEther("1");
            const excess = ethers.parseEther("0.5");

            const balanceBefore = await ethers.provider.getBalance(buyer.address);
            const tx = await marketplaceV2.connect(buyer).buy(0, { value: price + excess });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(buyer.address);

            const spent = balanceBefore - balanceAfter - gasUsed;
            expect(spent).to.equal(price);
        });

        it("Should fail to buy ERC20 listing with ETH", async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 1, ethers.parseEther("100"), await mockToken.getAddress()
            );

            await expect(
                marketplaceV2.connect(buyer).buy(1, { value: ethers.parseEther("100") })
            ).to.be.revertedWithCustomError(marketplaceV2, "PaymentMethodMismatch");
        });

        it("Should fail with insufficient payment", async function () {
            await expect(
                marketplaceV2.connect(buyer).buy(0, { value: ethers.parseEther("0.5") })
            ).to.be.revertedWithCustomError(marketplaceV2, "InsufficientPayment");
        });
    });

    describe("Buying with ERC20", function () {
        beforeEach(async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, ethers.parseEther("100"), await mockToken.getAddress()
            );

            // Approve marketplace to spend buyer's tokens
            await mockToken.connect(buyer).approve(await marketplaceV2.getAddress(), ethers.parseEther("10000"));
        });

        it("Should allow buying with ERC20 tokens", async function () {
            await marketplaceV2.connect(buyer).buyWithToken(0, ethers.parseEther("100"));

            expect(await erc721.ownerOf(0)).to.equal(buyer.address);
        });

        it("Should fail to buy ETH listing with tokens", async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 1, ethers.parseEther("1"), ethers.ZeroAddress
            );

            await expect(
                marketplaceV2.connect(buyer).buyWithToken(1, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(marketplaceV2, "PaymentMethodMismatch");
        });
    });



    describe("Cancel and Update Listing", function () {
        beforeEach(async function () {
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
            );
        });

        it("Should allow seller to cancel listing", async function () {
            await marketplaceV2.connect(seller).cancelListing(0);

            expect(await erc721.ownerOf(0)).to.equal(seller.address);
        });

        it("Should allow seller to update price", async function () {
            const newPrice = ethers.parseEther("2");
            await marketplaceV2.connect(seller).updatePrice(0, newPrice);

            const listing = await marketplaceV2.getListing(0);
            expect(listing.price).to.equal(newPrice);
        });

        it("Should fail if not seller", async function () {
            await expect(
                marketplaceV2.connect(buyer).cancelListing(0)
            ).to.be.revertedWithCustomError(marketplaceV2, "NotSeller");
        });
    });

    describe("Pausable", function () {
        beforeEach(async function () {
            await marketplaceV2.connect(admin).pause();
        });

        it("Should prevent listing when paused", async function () {
            await expect(
                marketplaceV2.connect(seller).listERC721(
                    await erc721.getAddress(), 1, ethers.parseEther("1"), ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(marketplaceV2, "EnforcedPause");
        });

        it("Should prevent buying when paused", async function () {
            await marketplaceV2.connect(admin).unpause();
            await marketplaceV2.connect(seller).listERC721(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
            );
            await marketplaceV2.connect(admin).pause();

            await expect(
                marketplaceV2.connect(buyer).buy(0, { value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(marketplaceV2, "EnforcedPause");
        });
    });

    describe("ERC1155 Listing", function () {
        it("Should list ERC1155 tokens", async function () {
            await marketplaceV2.connect(seller).listERC1155(
                await erc1155.getAddress(), 0, 50, ethers.parseEther("0.5"), ethers.ZeroAddress
            );

            const listing = await marketplaceV2.getListing(0);
            expect(listing.amount).to.equal(50);
            expect(listing.tokenType).to.equal(1); // ERC1155
        });
    });
});

// Mock ERC20 for testing
const MockERC20 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}
`;
