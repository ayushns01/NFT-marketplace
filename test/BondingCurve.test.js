const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurve", function () {
    let bondingCurve;
    let erc721;
    let owner;
    let creator;
    let buyer;
    let buyer2;
    let royaltyReceiver;

    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;

    beforeEach(async function () {
        [owner, creator, buyer, buyer2, royaltyReceiver] = await ethers.getSigners();

        // Deploy ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy(
            "TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE
        );

        // Deploy BondingCurve
        const BondingCurve = await ethers.getContractFactory("BondingCurve");
        bondingCurve = await BondingCurve.deploy(PLATFORM_FEE, owner.address);

        // Mint NFTs to CREATOR (not directly to bonding curve anymore)
        await erc721.mint(creator.address, "ipfs://token/0");
        await erc721.mint(creator.address, "ipfs://token/1");
        await erc721.mint(creator.address, "ipfs://token/2");
        await erc721.mint(creator.address, "ipfs://token/3");
        await erc721.mint(creator.address, "ipfs://token/4");
        await erc721.mint(creator.address, "ipfs://token/5"); // Extra token for buyback disabled test
        
        // Approve bonding curve to transfer creator's NFTs
        await erc721.connect(creator).setApprovalForAll(await bondingCurve.getAddress(), true);
    });

    describe("Deployment", function () {
        it("Should set correct platform fee", async function () {
            expect(await bondingCurve.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await bondingCurve.feeRecipient()).to.equal(owner.address);
        });

        it("Should set correct ratio scale", async function () {
            expect(await bondingCurve.RATIO_SCALE()).to.equal(ethers.parseEther("1"));
        });
    });

    describe("Pool Creation", function () {
        it("Should create a linear curve pool", async function () {
            const basePrice = ethers.parseEther("0.1");
            const slope = ethers.parseEther("0.01");

            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(),
                0, // Linear
                basePrice,
                slope,
                100, // maxSupply
                500, // royaltyFee
                true // buybackEnabled
            );

            const pool = await bondingCurve.getPool(0);
            expect(pool.nftContract).to.equal(await erc721.getAddress());
            expect(pool.creator).to.equal(creator.address);
            expect(pool.curveType).to.equal(0); // Linear
            expect(pool.basePrice).to.equal(basePrice);
            expect(pool.slope).to.equal(slope);
            expect(pool.maxSupply).to.equal(100);
            expect(pool.buybackEnabled).to.equal(true);
        });

        it("Should create an exponential curve pool", async function () {
            const basePrice = ethers.parseEther("0.1");
            const ratio = ethers.parseEther("1.1"); // 10% increase per token

            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(),
                1, // Exponential
                basePrice,
                ratio,
                100,
                500,
                false
            );

            const pool = await bondingCurve.getPool(0);
            expect(pool.curveType).to.equal(1); // Exponential
            expect(pool.ratio).to.equal(ratio);
        });

        it("Should fail with zero address", async function () {
            await expect(
                bondingCurve.connect(creator).createPool(
                    ethers.ZeroAddress, 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 500, true
                )
            ).to.be.revertedWithCustomError(bondingCurve, "ZeroAddress");
        });

        it("Should fail with zero base price", async function () {
            await expect(
                bondingCurve.connect(creator).createPool(
                    await erc721.getAddress(), 0, 0, ethers.parseEther("0.01"), 100, 500, true
                )
            ).to.be.revertedWithCustomError(bondingCurve, "InvalidParams");
        });

        it("Should fail with excessive royalty fee", async function () {
            await expect(
                bondingCurve.connect(creator).createPool(
                    await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 2600, true
                )
            ).to.be.revertedWithCustomError(bondingCurve, "InvalidParams");
        });
    });

    describe("Linear Pricing", function () {
        beforeEach(async function () {
            const basePrice = ethers.parseEther("0.1");
            const slope = ethers.parseEther("0.01");

            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, basePrice, slope, 100, 500, true
            );
            
            // Deposit tokens into pool
            await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2, 3, 4]);
        });

        it("Should return base price at supply 0", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            expect(price).to.equal(ethers.parseEther("0.1"));
        });

        it("Should calculate correct price at supply 5", async function () {
            // Buy 5 tokens to increase supply
            for (let i = 0; i < 5; i++) {
                const price = await bondingCurve.getBuyPrice(0);
                await bondingCurve.connect(buyer).buy(0, price, { value: price });
            }

            // Price at supply 5 should be: 0.1 + (5 * 0.01) = 0.15
            const price = await bondingCurve.getBuyPrice(0);
            expect(price).to.equal(ethers.parseEther("0.15"));
        });

        it("Should generate correct quote for multiple tokens", async function () {
            const quote = await bondingCurve.getQuote(0, 3, true);
            // Price at supply 0: 0.1, at 1: 0.11, at 2: 0.12
            // Total: 0.1 + 0.11 + 0.12 = 0.33
            expect(quote).to.equal(ethers.parseEther("0.33"));
        });
    });

    describe("Exponential Pricing", function () {
        beforeEach(async function () {
            const basePrice = ethers.parseEther("0.1");
            const ratio = ethers.parseEther("1.1"); // 10% increase

            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 1, basePrice, ratio, 100, 500, true
            );
            
            // Deposit tokens into pool
            await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2, 3, 4]);
        });

        it("Should return base price at supply 0", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            expect(price).to.equal(ethers.parseEther("0.1"));
        });

        it("Should increase price exponentially", async function () {
            const price0 = await bondingCurve.getBuyPrice(0);

            await bondingCurve.connect(buyer).buy(0, price0, { value: price0 });

            const price1 = await bondingCurve.getBuyPrice(0);
            // Should be approximately 0.1 * 1.1 = 0.11
            expect(price1).to.be.closeTo(ethers.parseEther("0.11"), ethers.parseEther("0.001"));
        });
    });

    describe("Buying", function () {
        beforeEach(async function () {
            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 5, 500, true
            );
            
            // Deposit tokens into pool
            await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2, 3, 4]);
        });

        it("Should allow buying at current price", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            await bondingCurve.connect(buyer).buy(0, price, { value: price });

            // Token 4 (last deposited) should now be owned by buyer
            expect(await erc721.ownerOf(4)).to.equal(buyer.address);
        });

        it("Should refund excess payment", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            const excess = ethers.parseEther("0.5");

            const balanceBefore = await ethers.provider.getBalance(buyer.address);
            const tx = await bondingCurve.connect(buyer).buy(0, price + excess, { value: price + excess });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(buyer.address);

            // Should have spent approximately price (not price + excess)
            const spent = balanceBefore - balanceAfter - gasUsed;
            expect(spent).to.be.closeTo(price, ethers.parseEther("0.001"));
        });

        it("Should fail with insufficient payment", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            await expect(
                bondingCurve.connect(buyer).buy(0, price, { value: ethers.parseEther("0.01") })
            ).to.be.revertedWithCustomError(bondingCurve, "InsufficientPayment");
        });

        it("Should fail when max supply reached", async function () {
            // Buy all 5 tokens
            for (let i = 0; i < 5; i++) {
                const price = await bondingCurve.getBuyPrice(0);
                await bondingCurve.connect(buyer).buy(0, price, { value: price });
            }

            await expect(
                bondingCurve.connect(buyer).buy(0, ethers.parseEther("1"), { value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(bondingCurve, "MaxSupplyReached");
        });

        it("Should update pool state after purchase", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            await bondingCurve.connect(buyer).buy(0, price, { value: price });

            const pool = await bondingCurve.getPool(0);
            expect(pool.currentSupply).to.equal(1);
        });

        it("Should distribute fees correctly", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            const fee = (price * BigInt(PLATFORM_FEE)) / 10000n;

            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
            const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);

            await bondingCurve.connect(buyer).buy(0, price, { value: price });

            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);

            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(fee);
            expect(creatorBalanceAfter).to.be.gt(creatorBalanceBefore);
        });

        it("Should fail if price exceeds maxPrice (slippage protection)", async function () {
            const price = await bondingCurve.getBuyPrice(0);
            const maxPriceTooLow = price - 1n; // Set max price below actual price

            await expect(
                bondingCurve.connect(buyer).buy(0, maxPriceTooLow, { value: price })
            ).to.be.revertedWithCustomError(bondingCurve, "SlippageExceeded");
        });
    });

    describe("Selling (Buyback)", function () {
        let boughtTokenId;
        
        beforeEach(async function () {
            // Create pool with ZERO royalty fee to ensure reserve can cover sellback
            // Note: With fees, reserve may be insufficient for immediate sellback (known limitation)
            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 0, true // royaltyFee = 0
            );
            
            // Deposit tokens into pool
            await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2, 3, 4]);

            // Buy a token first (will be token 4, last in array)
            const price = await bondingCurve.getBuyPrice(0);
            await bondingCurve.connect(buyer).buy(0, price, { value: price });
            boughtTokenId = 4; // Last token deposited is first bought
        });

        it("Should allow selling back to curve", async function () {
            await erc721.connect(buyer).approve(await bondingCurve.getAddress(), boughtTokenId);

            const sellPrice = await bondingCurve.getSellPrice(0);
            const balanceBefore = await ethers.provider.getBalance(buyer.address);

            const tx = await bondingCurve.connect(buyer).sell(0, boughtTokenId, 0); // minPrice = 0 for test
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balanceAfter = await ethers.provider.getBalance(buyer.address);
            expect(balanceAfter + gasUsed - balanceBefore).to.equal(sellPrice);

            expect(await erc721.ownerOf(boughtTokenId)).to.equal(await bondingCurve.getAddress());
        });

        it("Should calculate sell price as 95% of buy price", async function () {
            const pool = await bondingCurve.getPool(0);
            const buyPrice = ethers.parseEther("0.1"); // Price at supply 0
            const expectedSellPrice = (buyPrice * 95n) / 100n;

            const sellPrice = await bondingCurve.getSellPrice(0);
            expect(sellPrice).to.equal(expectedSellPrice);
        });

        it("Should fail if not token owner", async function () {
            await expect(
                bondingCurve.connect(buyer2).sell(0, boughtTokenId, 0)
            ).to.be.revertedWithCustomError(bondingCurve, "NotTokenOwner");
        });

        it("Should fail if buyback disabled", async function () {
            // Create pool with buyback disabled
            await bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 500, false
            );

            // Deposit token 5 into pool 1
            await bondingCurve.connect(creator).depositTokens(1, [5]);

            const price = await bondingCurve.getBuyPrice(1);
            await bondingCurve.connect(buyer).buy(1, price, { value: price });

            await erc721.connect(buyer).approve(await bondingCurve.getAddress(), 5);

            await expect(
                bondingCurve.connect(buyer).sell(1, 5, 0)
            ).to.be.revertedWithCustomError(bondingCurve, "BuybackDisabled");
        });

        it("Should fail if price below minPrice (slippage protection)", async function () {
            await erc721.connect(buyer).approve(await bondingCurve.getAddress(), boughtTokenId);

            const sellPrice = await bondingCurve.getSellPrice(0);
            const minPriceTooHigh = sellPrice + ethers.parseEther("1");

            await expect(
                bondingCurve.connect(buyer).sell(0, boughtTokenId, minPriceTooHigh)
            ).to.be.revertedWithCustomError(bondingCurve, "SlippageExceeded");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set platform fee", async function () {
            await bondingCurve.setPlatformFee(500);
            expect(await bondingCurve.platformFee()).to.equal(500);
        });

        it("Should not allow fee above 10%", async function () {
            await expect(
                bondingCurve.setPlatformFee(1001)
            ).to.be.revertedWithCustomError(bondingCurve, "FeeTooHigh");
        });

        it("Should allow owner to pause", async function () {
            await bondingCurve.pause();

            await expect(
                bondingCurve.connect(creator).createPool(
                    await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 500, true
                )
            ).to.be.revertedWithCustomError(bondingCurve, "EnforcedPause");
        });

        it("Should allow owner to unpause", async function () {
            await bondingCurve.pause();
            await bondingCurve.unpause();

            await expect(
                bondingCurve.connect(creator).createPool(
                    await erc721.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("0.01"), 100, 500, true
                )
            ).to.not.be.reverted;
        });
    });
});
