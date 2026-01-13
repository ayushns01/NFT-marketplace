const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AuctionEngine", function () {
    let auctionEngine;
    let erc721;
    let erc1155;
    let owner;
    let seller;
    let bidder1;
    let bidder2;
    let royaltyReceiver;

    const PLATFORM_FEE = 250;
    const ROYALTY_FEE = 500;
    const ONE_HOUR = 3600;
    const ONE_DAY = 86400;

    beforeEach(async function () {
        [owner, seller, bidder1, bidder2, royaltyReceiver] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy(
            "TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE
        );

        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        erc1155 = await ERC1155NFT.deploy(
            "TestMulti", "TMT", "ipfs://base/", royaltyReceiver.address, ROYALTY_FEE
        );

        const AuctionEngine = await ethers.getContractFactory("AuctionEngine");
        auctionEngine = await AuctionEngine.deploy(PLATFORM_FEE, owner.address);

        await erc721.mint(seller.address, "ipfs://token/0");
        await erc721.mint(seller.address, "ipfs://token/1");
        await erc1155.mint(seller.address, 100, "ipfs://multi/0");

        await erc721.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
        await erc1155.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
    });

    describe("Deployment", function () {
        it("Should set correct platform fee", async function () {
            expect(await auctionEngine.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await auctionEngine.feeRecipient()).to.equal(owner.address);
        });

        it("Should start with zero auctions", async function () {
            expect(await auctionEngine.getTotalAuctions()).to.equal(0);
        });
    });

    describe("English Auction Creation", function () {
        it("Should create an English auction", async function () {
            const startPrice = ethers.parseEther("1");
            const reservePrice = ethers.parseEther("0.5");

            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, startPrice, reservePrice, ONE_DAY
            );

            const auction = await auctionEngine.getAuction(0);
            expect(auction.seller).to.equal(seller.address);
            expect(auction.startPrice).to.equal(startPrice);
            expect(auction.reservePrice).to.equal(reservePrice);
            expect(auction.auctionType).to.equal(0); // English
        });

        it("Should transfer NFT to auction contract", async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), 0, ONE_DAY
            );

            expect(await erc721.ownerOf(0)).to.equal(await auctionEngine.getAddress());
        });

        it("Should fail with duration too short", async function () {
            await expect(
                auctionEngine.connect(seller).createEnglishAuction(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), 0, 60
                )
            ).to.be.revertedWithCustomError(auctionEngine, "InvalidDuration");
        });
    });

    describe("Dutch Auction Creation", function () {
        it("Should create a Dutch auction", async function () {
            const startPrice = ethers.parseEther("2");
            const endPrice = ethers.parseEther("0.5");

            await auctionEngine.connect(seller).createDutchAuction(
                await erc721.getAddress(), 0, startPrice, endPrice, ONE_DAY
            );

            const auction = await auctionEngine.getAuction(0);
            expect(auction.startPrice).to.equal(startPrice);
            expect(auction.endPrice).to.equal(endPrice);
            expect(auction.auctionType).to.equal(1); // Dutch
        });

        it("Should fail if start price <= end price", async function () {
            await expect(
                auctionEngine.connect(seller).createDutchAuction(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("1"), ONE_DAY
                )
            ).to.be.revertedWithCustomError(auctionEngine, "InvalidPrice");
        });
    });

    describe("English Auction Bidding", function () {
        beforeEach(async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), 0, ONE_DAY
            );
        });

        it("Should accept first bid at start price", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            const auction = await auctionEngine.getAuction(0);
            expect(auction.highestBidder).to.equal(bidder1.address);
            expect(auction.highestBid).to.equal(ethers.parseEther("1"));
        });

        it("Should accept higher bid", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });
            await auctionEngine.connect(bidder2).placeBid(0, { value: ethers.parseEther("1.1") });

            const auction = await auctionEngine.getAuction(0);
            expect(auction.highestBidder).to.equal(bidder2.address);
        });

        it("Should reject bid below minimum", async function () {
            await expect(
                auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("0.5") })
            ).to.be.revertedWithCustomError(auctionEngine, "BidTooLow");
        });

        it("Should add previous bid to pending returns", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });
            await auctionEngine.connect(bidder2).placeBid(0, { value: ethers.parseEther("1.1") });

            const pending = await auctionEngine.pendingReturns(bidder1.address);
            expect(pending).to.equal(ethers.parseEther("1"));
        });

        it("Should extend auction on late bid (anti-sniping)", async function () {
            const auction = await auctionEngine.getAuction(0);
            const originalEndTime = auction.endTime;

            await time.increaseTo(originalEndTime - BigInt(300)); // 5 minutes before end

            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            const updatedAuction = await auctionEngine.getAuction(0);
            expect(updatedAuction.endTime).to.be.gt(originalEndTime);
        });
    });

    describe("Dutch Auction Buying", function () {
        beforeEach(async function () {
            await auctionEngine.connect(seller).createDutchAuction(
                await erc721.getAddress(), 0, ethers.parseEther("2"), ethers.parseEther("0.5"), ONE_DAY
            );
        });

        it("Should calculate decreasing price", async function () {
            const priceAtStart = await auctionEngine.getDutchPrice(0);
            expect(priceAtStart).to.equal(ethers.parseEther("2"));

            await time.increase(ONE_DAY / 2);

            const priceAtHalf = await auctionEngine.getDutchPrice(0);
            expect(priceAtHalf).to.be.closeTo(ethers.parseEther("1.25"), ethers.parseEther("0.01"));
        });

        it("Should allow buying at current price", async function () {
            await time.increase(ONE_DAY / 2);
            const currentPrice = await auctionEngine.getDutchPrice(0);

            await auctionEngine.connect(bidder1).placeBid(0, { value: currentPrice });

            expect(await erc721.ownerOf(0)).to.equal(bidder1.address);
        });

        it("Should refund excess payment", async function () {
            const balanceBefore = await ethers.provider.getBalance(bidder1.address);
            const startPrice = ethers.parseEther("2");

            const tx = await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("3") });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balanceAfter = await ethers.provider.getBalance(bidder1.address);
            const spent = balanceBefore - balanceAfter - gasUsed;

            // Should spend approximately the start price (some variance due to block timing)
            expect(spent).to.be.closeTo(startPrice, ethers.parseEther("0.01"));
        });
    });

    describe("Ending Auction", function () {
        beforeEach(async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), 0, ONE_DAY
            );
        });

        it("Should end auction and transfer NFT to winner", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            await time.increase(ONE_DAY + 1);
            await auctionEngine.endAuction(0);

            expect(await erc721.ownerOf(0)).to.equal(bidder1.address);
        });

        it("Should return NFT to seller if no bids", async function () {
            await time.increase(ONE_DAY + 1);
            await auctionEngine.endAuction(0);

            expect(await erc721.ownerOf(0)).to.equal(seller.address);
        });

        it("Should return NFT to seller if reserve not met", async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 1, ethers.parseEther("0.5"), ethers.parseEther("2"), ONE_DAY
            );

            await auctionEngine.connect(bidder1).placeBid(1, { value: ethers.parseEther("1") });

            await time.increase(ONE_DAY + 1);
            await auctionEngine.endAuction(1);

            expect(await erc721.ownerOf(1)).to.equal(seller.address);
            expect(await auctionEngine.pendingReturns(bidder1.address)).to.equal(ethers.parseEther("1"));
        });

        it("Should distribute fees correctly", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            const bid = ethers.parseEther("1");
            const platformAmount = (bid * BigInt(PLATFORM_FEE)) / 10000n;

            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

            await time.increase(ONE_DAY + 1);
            await auctionEngine.endAuction(0);

            const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

            // Owner gets platform fee
            expect(ownerBalanceAfter - ownerBalanceBefore).to.be.closeTo(platformAmount, ethers.parseEther("0.001"));

            // Seller gets remaining after fees
            expect(sellerBalanceAfter).to.be.gt(sellerBalanceBefore);
        });

        it("Should fail to end before time", async function () {
            await expect(auctionEngine.endAuction(0)).to.be.revertedWithCustomError(auctionEngine, "AuctionStillActive");
        });
    });

    describe("Cancel Auction", function () {
        beforeEach(async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), 0, ONE_DAY
            );
        });

        it("Should allow seller to cancel without bids", async function () {
            await auctionEngine.connect(seller).cancelAuction(0);

            expect(await erc721.ownerOf(0)).to.equal(seller.address);
            const auction = await auctionEngine.getAuction(0);
            expect(auction.status).to.equal(2); // Cancelled
        });

        it("Should not allow cancel with bids", async function () {
            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            await expect(
                auctionEngine.connect(seller).cancelAuction(0)
            ).to.be.revertedWithCustomError(auctionEngine, "HasBids");
        });

        it("Should not allow non-seller to cancel", async function () {
            await expect(
                auctionEngine.connect(bidder1).cancelAuction(0)
            ).to.be.revertedWithCustomError(auctionEngine, "NotSeller");
        });
    });

    describe("Withdraw Pending Returns", function () {
        it("Should allow withdrawing pending returns", async function () {
            await auctionEngine.connect(seller).createEnglishAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), 0, ONE_DAY
            );

            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });
            await auctionEngine.connect(bidder2).placeBid(0, { value: ethers.parseEther("1.5") });

            const balanceBefore = await ethers.provider.getBalance(bidder1.address);
            const tx = await auctionEngine.connect(bidder1).withdrawPendingReturns();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(bidder1.address);

            expect(balanceAfter + gasUsed - balanceBefore).to.equal(ethers.parseEther("1"));
        });
    });

    describe("ERC1155 Auction", function () {
        it("Should create ERC1155 auction", async function () {
            await auctionEngine.connect(seller).createERC1155Auction(
                await erc1155.getAddress(), 0, 50, ethers.parseEther("1"), 0, ONE_DAY
            );

            const auction = await auctionEngine.getAuction(0);
            expect(auction.amount).to.equal(50);
            expect(auction.tokenType).to.equal(1); // ERC1155
        });

        it("Should transfer tokens to winner", async function () {
            await auctionEngine.connect(seller).createERC1155Auction(
                await erc1155.getAddress(), 0, 50, ethers.parseEther("1"), 0, ONE_DAY
            );

            await auctionEngine.connect(bidder1).placeBid(0, { value: ethers.parseEther("1") });

            await time.increase(ONE_DAY + 1);
            await auctionEngine.endAuction(0);

            expect(await erc1155.balanceOf(bidder1.address, 0)).to.equal(50);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set platform fee", async function () {
            await auctionEngine.setPlatformFee(500);
            expect(await auctionEngine.platformFee()).to.equal(500);
        });

        it("Should allow owner to set anti-sniping duration", async function () {
            await auctionEngine.setAntiSnipingDuration(600);
            expect(await auctionEngine.antiSnipingDuration()).to.equal(600);
        });

        it("Should allow owner to pause", async function () {
            await auctionEngine.pause();

            await expect(
                auctionEngine.connect(seller).createEnglishAuction(
                    await erc721.getAddress(), 1, ethers.parseEther("1"), 0, ONE_DAY
                )
            ).to.be.revertedWithCustomError(auctionEngine, "EnforcedPause");
        });
    });
});
