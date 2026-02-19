const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Edge Case Tests — Targeting Uncovered Branches
 * 
 * These tests specifically target branches that were not covered by existing tests,
 * identified via Istanbul coverage reports. Each test section documents the exact
 * branch being targeted.
 */

describe("Edge Cases: Marketplace", function () {
    let marketplace, erc721, erc1155, noRoyaltyNft, highRoyaltyNft;
    let owner, seller, buyer, royaltyReceiver;
    const PLATFORM_FEE = 250;
    const ROYALTY_FEE = 500;

    beforeEach(async function () {
        [owner, seller, buyer, royaltyReceiver] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE);

        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        erc1155 = await ERC1155NFT.deploy("TestMulti", "TMT", "ipfs://base/", royaltyReceiver.address, ROYALTY_FEE);

        const MockERC721NoRoyalty = await ethers.getContractFactory("MockERC721NoRoyalty");
        noRoyaltyNft = await MockERC721NoRoyalty.deploy();

        const MockERC721HighRoyalty = await ethers.getContractFactory("MockERC721HighRoyalty");
        highRoyaltyNft = await MockERC721HighRoyalty.deploy(royaltyReceiver.address);

        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(PLATFORM_FEE, owner.address);

        await erc721.mint(seller.address, "ipfs://token/0");
        await erc1155.mint(seller.address, 100, "ipfs://multi/0");
        await noRoyaltyNft.connect(seller).mint(seller.address);
        await highRoyaltyNft.connect(seller).mint(seller.address);

        await erc721.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await erc1155.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await noRoyaltyNft.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await highRoyaltyNft.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
    });

    // Branch: _executeSale ERC1155 path (else branch of tokenType check)
    it("Should buy an ERC1155 listing", async function () {
        await marketplace.connect(seller).listERC1155(
            await erc1155.getAddress(), 0, 50, ethers.parseEther("1")
        );
        await mine(1);
        await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });

        expect(await erc1155.balanceOf(buyer.address, 0)).to.equal(50);
    });

    // Branch: catch{} on royaltyInfo for non-ERC2981 NFTs
    it("Should handle NFT without ERC2981 (no royalty)", async function () {
        await marketplace.connect(seller).listERC721(
            await noRoyaltyNft.getAddress(), 0, ethers.parseEther("1")
        );
        await mine(1);

        const price = ethers.parseEther("1");
        await marketplace.connect(buyer).buy(0, { value: price });

        // No royalty: seller gets price - platformFee
        const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
        const sellerAmount = price - platformAmount;
        expect(await marketplace.pendingWithdrawals(seller.address)).to.equal(sellerAmount);
    });

    // Branch: royalty cap ternary — royalty > 10% should be capped
    it("Should cap royalty at 10% for high-royalty NFTs", async function () {
        await marketplace.connect(seller).listERC721(
            await highRoyaltyNft.getAddress(), 0, ethers.parseEther("1")
        );
        await mine(1);

        const price = ethers.parseEther("1");
        await marketplace.connect(buyer).buy(0, { value: price });

        // 50% royalty should be capped at 10%
        const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
        const cappedRoyalty = price / 10n; // 10% cap
        const sellerAmount = price - platformAmount - cappedRoyalty;

        expect(await marketplace.pendingWithdrawals(royaltyReceiver.address)).to.equal(cappedRoyalty);
        expect(await marketplace.pendingWithdrawals(seller.address)).to.equal(sellerAmount);
    });

    // Branch: platformAmount == 0 (false branch of platformAmount > 0)
    it("Should handle zero platform fee correctly", async function () {
        const Marketplace = await ethers.getContractFactory("Marketplace");
        const zeroFeeMarket = await Marketplace.deploy(0, owner.address);
        await erc721.mint(seller.address, "ipfs://token/99");
        await erc721.connect(seller).setApprovalForAll(await zeroFeeMarket.getAddress(), true);

        await zeroFeeMarket.connect(seller).listERC721(
            await erc721.getAddress(), 1, ethers.parseEther("1")
        );
        await mine(1);

        await zeroFeeMarket.connect(buyer).buy(0, { value: ethers.parseEther("1") });

        // Listing should be sold
        const listing = await zeroFeeMarket.getListing(0);
        expect(listing.status).to.equal(1); // Sold
    });

    // Branch: withdrawFunds with nothing to withdraw
    it("Should revert withdrawFunds with no pending balance", async function () {
        await expect(
            marketplace.connect(buyer).withdrawFunds()
        ).to.be.revertedWithCustomError(marketplace, "NothingToWithdraw");
    });

    // Branch: withdrawFunds success path
    it("Should allow successful withdrawal after sale", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        await mine(1);
        await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });

        const pending = await marketplace.pendingWithdrawals(seller.address);
        expect(pending).to.be.gt(0);

        const balBefore = await ethers.provider.getBalance(seller.address);
        const tx = await marketplace.connect(seller).withdrawFunds();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balAfter = await ethers.provider.getBalance(seller.address);

        expect(balAfter + gasUsed - balBefore).to.equal(pending);
        expect(await marketplace.pendingWithdrawals(seller.address)).to.equal(0);
    });

    // Branch: setFeeRecipient with zero address
    it("Should revert setFeeRecipient with zero address", async function () {
        await expect(
            marketplace.setFeeRecipient(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });

    // Branch: listERC721 with zero address nftContract
    it("Should revert listERC721 with zero address", async function () {
        await expect(
            marketplace.connect(seller).listERC721(ethers.ZeroAddress, 0, ethers.parseEther("1"))
        ).to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });

    // Branch: listERC1155 with zero address
    it("Should revert listERC1155 with zero address", async function () {
        await expect(
            marketplace.connect(seller).listERC1155(ethers.ZeroAddress, 0, 10, ethers.parseEther("1"))
        ).to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });

    // Branch: listERC1155 with zero amount
    it("Should revert listERC1155 with zero amount", async function () {
        await expect(
            marketplace.connect(seller).listERC1155(await erc1155.getAddress(), 0, 0, ethers.parseEther("1"))
        ).to.be.revertedWithCustomError(marketplace, "InvalidAmount");
    });

    // Branch: cancelListing ERC1155 path
    it("Should cancel an ERC1155 listing and return tokens", async function () {
        await marketplace.connect(seller).listERC1155(
            await erc1155.getAddress(), 0, 50, ethers.parseEther("1")
        );
        await marketplace.connect(seller).cancelListing(0);
        expect(await erc1155.balanceOf(seller.address, 0)).to.equal(100);
    });

    // Branch: updatePrice on cancelled listing
    it("Should revert updatePrice on cancelled listing", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        await marketplace.connect(seller).cancelListing(0);
        await expect(
            marketplace.connect(seller).updatePrice(0, ethers.parseEther("2"))
        ).to.be.revertedWithCustomError(marketplace, "ListingNotActive");
    });

    // Branch: updatePrice with zero price
    it("Should revert updatePrice with zero price", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        await expect(
            marketplace.connect(seller).updatePrice(0, 0)
        ).to.be.revertedWithCustomError(marketplace, "InvalidPrice");
    });

    // Branch: makeOffer with zero value
    it("Should revert makeOffer with zero value", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        await expect(
            marketplace.connect(buyer).makeOffer(0, 0, { value: 0 })
        ).to.be.revertedWithCustomError(marketplace, "InvalidPrice");
    });

    // Branch: acceptOffer with expired offer
    it("Should revert acceptOffer with expired offer", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        const now = await time.latest();
        await marketplace.connect(buyer).makeOffer(0, now + 10, { value: ethers.parseEther("0.8") });
        await time.increase(100);
        await expect(
            marketplace.connect(seller).acceptOffer(0, 0)
        ).to.be.revertedWithCustomError(marketplace, "OfferExpired");
    });

    // Branch: cancelOffer by non-buyer
    it("Should revert cancelOffer by non-buyer", async function () {
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        await marketplace.connect(buyer).makeOffer(0, 0, { value: ethers.parseEther("0.8") });
        await expect(
            marketplace.connect(seller).cancelOffer(0, 0)
        ).to.be.revertedWithCustomError(marketplace, "NotBuyer");
    });

    // Branch: unpause
    it("Should allow owner to unpause", async function () {
        await marketplace.pause();
        await marketplace.unpause();

        // Should be able to list again
        await marketplace.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1")
        );
        expect(await marketplace.getTotalListings()).to.equal(1);
    });
});

describe("Edge Cases: AuctionEngine", function () {
    let auctionEngine, erc721, noRoyaltyNft, highRoyaltyNft;
    let owner, seller, buyer, royaltyReceiver;
    const PLATFORM_FEE = 250;
    const ROYALTY_FEE = 500;

    beforeEach(async function () {
        [owner, seller, buyer, royaltyReceiver] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE);

        const MockERC721NoRoyalty = await ethers.getContractFactory("MockERC721NoRoyalty");
        noRoyaltyNft = await MockERC721NoRoyalty.deploy();

        const MockERC721HighRoyalty = await ethers.getContractFactory("MockERC721HighRoyalty");
        highRoyaltyNft = await MockERC721HighRoyalty.deploy(royaltyReceiver.address);

        const AuctionEngine = await ethers.getContractFactory("AuctionEngine");
        auctionEngine = await AuctionEngine.deploy(PLATFORM_FEE, owner.address);

        await erc721.mint(seller.address, "ipfs://0");
        await erc721.mint(seller.address, "ipfs://1");
        await erc721.mint(seller.address, "ipfs://2");
        await noRoyaltyNft.connect(seller).mint(seller.address);
        await highRoyaltyNft.connect(seller).mint(seller.address);

        await erc721.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
        await noRoyaltyNft.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
        await highRoyaltyNft.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
    });

    // Branch: setFeeRecipient with zero address
    it("Should revert setFeeRecipient with zero address", async function () {
        await expect(
            auctionEngine.setFeeRecipient(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(auctionEngine, "ZeroAddress");
    });

    // Branch: getDutchPrice at/past endTime
    it("Should return endPrice for Dutch auction past end time", async function () {
        const startPrice = ethers.parseEther("10");
        const endPrice = ethers.parseEther("1");
        const duration = 3600;

        await auctionEngine.connect(seller).createDutchAuction(
            await erc721.getAddress(), 0, startPrice, endPrice, duration
        );

        await time.increase(duration + 1);
        const price = await auctionEngine.getDutchPrice(0);
        expect(price).to.equal(endPrice);
    });

    // Branch: _distributePayment catch{} for non-ERC2981 NFT
    it("Should handle auction with non-ERC2981 NFT (no royalty)", async function () {
        await auctionEngine.connect(seller).createEnglishAuction(
            await noRoyaltyNft.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("0.5"), 3600
        );

        await auctionEngine.connect(buyer).placeBid(0, { value: ethers.parseEther("2") });
        await time.increase(3601);
        await auctionEngine.endAuction(0);

        // Seller should get price - platform fee (no royalty)
        const price = ethers.parseEther("2");
        const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
        const sellerAmount = price - platformAmount;
        expect(await auctionEngine.pendingReturns(seller.address)).to.equal(sellerAmount);
    });

    // Branch: _distributePayment royalty cap for high-royalty NFT
    it("Should cap royalty at 10% for high-royalty NFT in auction", async function () {
        await auctionEngine.connect(seller).createEnglishAuction(
            await highRoyaltyNft.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("0.5"), 3600
        );

        await auctionEngine.connect(buyer).placeBid(0, { value: ethers.parseEther("2") });
        await time.increase(3601);
        await auctionEngine.endAuction(0);

        const price = ethers.parseEther("2");
        const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
        const cappedRoyalty = price / 10n;
        const sellerAmount = price - platformAmount - cappedRoyalty;

        expect(await auctionEngine.pendingReturns(royaltyReceiver.address)).to.equal(cappedRoyalty);
        expect(await auctionEngine.pendingReturns(seller.address)).to.equal(sellerAmount);
    });

    // Branch: auction with zero platform fee
    it("Should handle auction with zero platform fee", async function () {
        const AuctionEngine = await ethers.getContractFactory("AuctionEngine");
        const zeroFeeAuction = await AuctionEngine.deploy(0, owner.address);
        await erc721.mint(seller.address, "ipfs://zf");
        await erc721.connect(seller).setApprovalForAll(await zeroFeeAuction.getAddress(), true);

        await zeroFeeAuction.connect(seller).createEnglishAuction(
            await erc721.getAddress(), 3, ethers.parseEther("1"), ethers.parseEther("0.5"), 3600
        );
        await zeroFeeAuction.connect(buyer).placeBid(0, { value: ethers.parseEther("2") });
        await time.increase(3601);
        await zeroFeeAuction.endAuction(0);

        const auction = await zeroFeeAuction.getAuction(0);
        expect(auction.status).to.equal(1); // Ended
    });

    // Branch: setMinBidIncrement
    it("Should allow owner to set min bid increment", async function () {
        await auctionEngine.setMinBidIncrement(1000);
        expect(await auctionEngine.minBidIncrementBps()).to.equal(1000);
    });

    // Branch: unpause
    it("Should allow owner to unpause", async function () {
        await auctionEngine.pause();
        await auctionEngine.unpause();

        await auctionEngine.connect(seller).createEnglishAuction(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("0.5"), 3600
        );
        expect(await auctionEngine.getTotalAuctions()).to.equal(1);
    });
});

describe("Edge Cases: BondingCurve", function () {
    let bondingCurve, erc721;
    let owner, creator, buyer;
    const PLATFORM_FEE = 250;

    beforeEach(async function () {
        [owner, creator, buyer] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, ethers.ZeroAddress, 0);

        const BondingCurve = await ethers.getContractFactory("BondingCurve");
        bondingCurve = await BondingCurve.deploy(PLATFORM_FEE, owner.address);

        // Mint NFTs to creator
        for (let i = 0; i < 5; i++) {
            await erc721.mint(creator.address, `ipfs://token/${i}`);
        }
        await erc721.connect(creator).setApprovalForAll(await bondingCurve.getAddress(), true);
    });

    // Branch: withdrawTokens — creator withdraws unsold tokens
    it("Should allow creator to withdraw unsold tokens", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2]);

        await bondingCurve.connect(creator).withdrawTokens(0, [1]);
        expect(await erc721.ownerOf(1)).to.equal(creator.address);
    });

    // Branch: withdrawTokens — non-creator reverts
    it("Should revert withdrawTokens by non-creator", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        await expect(
            bondingCurve.connect(buyer).withdrawTokens(0, [0])
        ).to.be.revertedWithCustomError(bondingCurve, "NotPoolCreator");
    });

    // Branch: _removeTokenFromPool — token not in pool
    it("Should revert withdrawing token not in pool", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        await expect(
            bondingCurve.connect(creator).withdrawTokens(0, [4])
        ).to.be.revertedWithCustomError(bondingCurve, "TokenNotInPool");
    });

    // Branch: emergencyWithdrawNFT — happy path (no reserve)
    it("Should allow owner to emergency-withdraw NFT when no reserve", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, false // buyback DISABLED → no reserve
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        await bondingCurve.emergencyWithdrawNFT(0, 0, owner.address);
        expect(await erc721.ownerOf(0)).to.equal(owner.address);
    });

    // Branch: emergencyWithdrawNFT — pool has reserve
    it("Should revert emergencyWithdrawNFT if pool has reserve", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0, 1]);

        // Buy a token to create reserve
        const price = await bondingCurve.getBuyPrice(0);
        await bondingCurve.connect(buyer).buy(0, price, { value: price });

        await expect(
            bondingCurve.emergencyWithdrawNFT(0, 1, owner.address)
        ).to.be.revertedWithCustomError(bondingCurve, "InvalidParams");
    });

    // Branch: emergencyWithdrawNFT — invalid pool
    it("Should revert emergencyWithdrawNFT for invalid pool", async function () {
        await expect(
            bondingCurve.emergencyWithdrawNFT(999, 0, owner.address)
        ).to.be.revertedWithCustomError(bondingCurve, "InvalidPool");
    });

    // Branch: emergencyWithdrawNFT — zero recipient
    it("Should revert emergencyWithdrawNFT with zero recipient", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, false
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        await expect(
            bondingCurve.emergencyWithdrawNFT(0, 0, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(bondingCurve, "ZeroAddress");
    });

    // Branch: getQuote for sell direction
    it("Should return correct sell quote", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2]);

        // Buy 3 tokens to create supply
        for (let i = 0; i < 3; i++) {
            const price = await bondingCurve.getBuyPrice(0);
            await bondingCurve.connect(buyer).buy(0, price, { value: price });
        }

        const sellQuote = await bondingCurve.getQuote(0, 2, false);
        expect(sellQuote).to.be.gt(0);
    });

    // Branch: getQuote sell with supply <= i (edge case)
    it("Should handle sell quote when quantity exceeds supply", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        // No tokens bought, supply = 0
        const sellQuote = await bondingCurve.getQuote(0, 5, false);
        expect(sellQuote).to.equal(0);
    });

    // Branch: withdrawCreatorPayments — nothing to withdraw
    it("Should revert withdrawCreatorPayments with no balance", async function () {
        await expect(
            bondingCurve.connect(buyer).withdrawCreatorPayments()
        ).to.be.revertedWithCustomError(bondingCurve, "NothingToWithdraw");
    });

    // Branch: withdrawCreatorPayments — success path
    it("Should allow creator to withdraw accumulated payments", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        const price = await bondingCurve.getBuyPrice(0);
        await bondingCurve.connect(buyer).buy(0, price, { value: price });

        const pending = await bondingCurve.pendingCreatorPayments(creator.address);
        expect(pending).to.be.gt(0);

        await bondingCurve.connect(creator).withdrawCreatorPayments();
        expect(await bondingCurve.pendingCreatorPayments(creator.address)).to.equal(0);
    });

    // Branch: exponential curve — odd exponent for _pow
    it("Should handle exponential curve with odd supply levels", async function () {
        const ratio = ethers.parseEther("1.1"); // 10% increase
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 1, ethers.parseEther("0.1"),
            ratio, 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0, 1, 2, 3, 4]);

        // Buy 3 tokens to reach supply=3 (odd number tests _pow odd exponent branch)
        for (let i = 0; i < 3; i++) {
            const price = await bondingCurve.getBuyPrice(0);
            await bondingCurve.connect(buyer).buy(0, price, { value: price });
        }

        const price = await bondingCurve.getBuyPrice(0);
        expect(price).to.be.gt(0);
    });

    // Branch: createPool with zero basePrice
    it("Should revert createPool with zero basePrice", async function () {
        await expect(
            bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, 0,
                ethers.parseEther("0.01"), 100, 500, true
            )
        ).to.be.revertedWithCustomError(bondingCurve, "InvalidParams");
    });

    // Branch: createPool with zero maxSupply
    it("Should revert createPool with zero maxSupply", async function () {
        await expect(
            bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, ethers.parseEther("0.1"),
                ethers.parseEther("0.01"), 0, 500, true
            )
        ).to.be.revertedWithCustomError(bondingCurve, "InvalidMaxSupply");
    });

    // Branch: createPool with excess royalty
    it("Should revert createPool with royalty > 25%", async function () {
        await expect(
            bondingCurve.connect(creator).createPool(
                await erc721.getAddress(), 0, ethers.parseEther("0.1"),
                ethers.parseEther("0.01"), 100, 2501, true
            )
        ).to.be.revertedWithCustomError(bondingCurve, "InvalidParams");
    });

    // Branch: sell with buyback disabled
    it("Should revert sell when buyback is disabled", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, false
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        const price = await bondingCurve.getBuyPrice(0);
        await bondingCurve.connect(buyer).buy(0, price, { value: price });
        await erc721.connect(buyer).setApprovalForAll(await bondingCurve.getAddress(), true);

        await expect(
            bondingCurve.connect(buyer).sell(0, 0, 0)
        ).to.be.revertedWithCustomError(bondingCurve, "BuybackDisabled");
    });

    // Branch: SlippageExceeded on buy
    it("Should revert buy when slippage exceeded", async function () {
        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
        await bondingCurve.connect(creator).depositTokens(0, [0]);

        await expect(
            bondingCurve.connect(buyer).buy(0, 1, { value: ethers.parseEther("1") })
        ).to.be.revertedWithCustomError(bondingCurve, "SlippageExceeded");
    });

    // Branch: unpause
    it("Should allow owner to unpause", async function () {
        await bondingCurve.pause();
        await bondingCurve.unpause();

        await bondingCurve.connect(creator).createPool(
            await erc721.getAddress(), 0, ethers.parseEther("0.1"),
            ethers.parseEther("0.01"), 100, 500, true
        );
    });
});

describe("Edge Cases: FractionalVault", function () {
    let vault, nft, shareTokenAddr;
    let owner, curator, buyer, shareholder1, shareholder2;
    const INITIAL_SHARES = 1_000_000n;
    const RESERVE_PRICE = ethers.parseEther("10");

    beforeEach(async function () {
        [owner, curator, buyer, shareholder1, shareholder2] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        nft = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, ethers.ZeroAddress, 0);

        const FractionalVault = await ethers.getContractFactory("FractionalVault");
        vault = await FractionalVault.deploy();

        await nft.mint(curator.address, "ipfs://test");
        await nft.connect(curator).approve(await vault.getAddress(), 0);

        await vault.connect(curator).fractionalize(
            await nft.getAddress(), 0, INITIAL_SHARES, RESERVE_PRICE, "Fractional", "FRAC"
        );

        const v = await vault.getVault(1);
        shareTokenAddr = v.shareToken;
    });

    // Branch: withdrawDust — full flow: buyout → all claim → curator withdraws dust
    it("Should allow curator to withdraw dust after all shares claimed", async function () {
        const ShareToken = await ethers.getContractFactory("ShareToken");
        const shareToken = ShareToken.attach(shareTokenAddr);

        // Approve vault to burn shares
        await shareToken.connect(curator).approveVaultBurn(true);

        // Buyer buys out
        await vault.connect(buyer).buyout(1, { value: RESERVE_PRICE });

        // Curator claims all shares
        await vault.connect(curator).claimProceeds(1);

        // Now all shares burned, curator can withdraw dust
        const dustBalance = await vault.vaultBalances(1);
        if (dustBalance > 0n) {
            await vault.connect(curator).withdrawDust(1);
            expect(await vault.vaultBalances(1)).to.equal(0);
        }
    });

    // Branch: withdrawDust — non-curator
    it("Should revert withdrawDust by non-curator", async function () {
        const ShareToken = await ethers.getContractFactory("ShareToken");
        const shareToken = ShareToken.attach(shareTokenAddr);
        await shareToken.connect(curator).approveVaultBurn(true);
        await vault.connect(buyer).buyout(1, { value: RESERVE_PRICE });
        await vault.connect(curator).claimProceeds(1);

        await expect(
            vault.connect(buyer).withdrawDust(1)
        ).to.be.revertedWithCustomError(vault, "NotCurator");
    });

    // Branch: withdrawDust — vault not in Bought state
    it("Should revert withdrawDust when vault is Active", async function () {
        await expect(
            vault.connect(curator).withdrawDust(1)
        ).to.be.revertedWithCustomError(vault, "VaultNotBought");
    });

    // Branch: withdrawDust — shares still outstanding
    it("Should revert withdrawDust when shares still exist", async function () {
        await vault.connect(buyer).buyout(1, { value: RESERVE_PRICE });

        await expect(
            vault.connect(curator).withdrawDust(1)
        ).to.be.revertedWithCustomError(vault, "NothingToClaim");
    });

    // Branch: claimProceeds — vault not in Bought state
    it("Should revert claimProceeds when vault is Active", async function () {
        await expect(
            vault.connect(curator).claimProceeds(1)
        ).to.be.revertedWithCustomError(vault, "VaultNotBought");
    });

    // Branch: claimProceeds — zero shares
    it("Should revert claimProceeds with zero shares", async function () {
        await vault.connect(buyer).buyout(1, { value: RESERVE_PRICE });

        await expect(
            vault.connect(shareholder1).claimProceeds(1)
        ).to.be.revertedWithCustomError(vault, "NothingToClaim");
    });

    // Branch: redeem — not all shares owned
    it("Should revert redeem if not all shares owned", async function () {
        const ShareToken = await ethers.getContractFactory("ShareToken");
        const shareToken = ShareToken.attach(shareTokenAddr);
        await shareToken.connect(curator).transfer(shareholder1.address, 1000);

        await expect(
            vault.connect(curator).redeem(1)
        ).to.be.revertedWithCustomError(vault, "NotAllSharesOwned");
    });

    // Branch: updateReservePrice — non-curator
    it("Should revert updateReservePrice by non-curator", async function () {
        await expect(
            vault.connect(buyer).updateReservePrice(1, ethers.parseEther("20"))
        ).to.be.revertedWithCustomError(vault, "NotCurator");
    });

    // Branch: updateReservePrice — inactive vault
    it("Should revert updateReservePrice on bought vault", async function () {
        await vault.connect(buyer).buyout(1, { value: RESERVE_PRICE });
        await expect(
            vault.connect(curator).updateReservePrice(1, ethers.parseEther("20"))
        ).to.be.revertedWithCustomError(vault, "VaultNotActive");
    });

    // Branch: fractionalize — duplicate NFT
    it("Should revert fractionalizing already vaulted NFT", async function () {
        await nft.mint(curator.address, "ipfs://test2");
        // Try to vault same NFT (tokenId 0) — already vaulted
        await expect(
            vault.connect(curator).fractionalize(
                await nft.getAddress(), 0, INITIAL_SHARES, RESERVE_PRICE, "Dup", "DUP"
            )
        ).to.be.revertedWithCustomError(vault, "NFTAlreadyVaulted");
    });

    // Branch: fractionalize — zero shares
    it("Should revert fractionalize with zero shares", async function () {
        await nft.mint(curator.address, "ipfs://test3");
        await nft.connect(curator).approve(await vault.getAddress(), 1);
        await expect(
            vault.connect(curator).fractionalize(
                await nft.getAddress(), 1, 0, RESERVE_PRICE, "Zero", "ZERO"
            )
        ).to.be.revertedWithCustomError(vault, "InvalidShares");
    });

    // Branch: multi-shareholder claim with pro-rata distribution
    it("Should distribute pro-rata to multiple shareholders", async function () {
        const ShareToken = await ethers.getContractFactory("ShareToken");
        const shareToken = ShareToken.attach(shareTokenAddr);

        // Distribute shares
        await shareToken.connect(curator).transfer(shareholder1.address, 300_000);
        await shareToken.connect(curator).transfer(shareholder2.address, 200_000);
        // Curator keeps 500_000

        // Approve vault burns
        await shareToken.connect(curator).approveVaultBurn(true);
        await shareToken.connect(shareholder1).approveVaultBurn(true);
        await shareToken.connect(shareholder2).approveVaultBurn(true);

        // Buyout at 15 ETH
        await vault.connect(buyer).buyout(1, { value: ethers.parseEther("15") });

        // All claim
        await vault.connect(curator).claimProceeds(1);
        await vault.connect(shareholder1).claimProceeds(1);
        await vault.connect(shareholder2).claimProceeds(1);

        // All shares should be burned
        expect(await shareToken.totalSupply()).to.equal(0);
    });
});

describe("Edge Cases: LazyMinting", function () {
    let lazyMinting, nftContract;
    let owner, creator, buyer;
    const PLATFORM_FEE = 250;

    beforeEach(async function () {
        [owner, creator, buyer] = await ethers.getSigners();

        const LazyMinting = await ethers.getContractFactory("LazyMinting");
        lazyMinting = await LazyMinting.deploy(PLATFORM_FEE, owner.address);

        // Deploy ERC721NFTInitializable via NFTFactory (same as existing LazyMinting.test.js)
        const ERC721NFTInitializable = await ethers.getContractFactory("ERC721NFTInitializable");
        const impl = await ERC721NFTInitializable.deploy();
        await impl.waitForDeployment();

        const NFTFactory = await ethers.getContractFactory("NFTFactory");
        const factory = await NFTFactory.deploy(await impl.getAddress(), await impl.getAddress());
        await factory.waitForDeployment();

        const tx = await factory.connect(creator).createERC721Collection(
            "LazyNFT", "LNFT", 10000, creator.address, 0 // zero royalty for some tests
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => l.fragment?.name === "ERC721CollectionCreated");
        const nftAddress = event.args.collection;
        nftContract = await ethers.getContractAt("ERC721NFTInitializable", nftAddress);

        // Disable whitelist so LazyMinting can mint
        await nftContract.connect(creator).setWhitelistEnabled(false);

        // Authorize nft contract
        await lazyMinting.authorizeContract(await nftContract.getAddress(), true);
    });

    // Branch: authorizeContract with zero address
    it("Should revert authorizeContract with zero address", async function () {
        await expect(
            lazyMinting.authorizeContract(ethers.ZeroAddress, true)
        ).to.be.revertedWithCustomError(lazyMinting, "ZeroAddress");
    });

    // Branch: setPlatformFee above 10%
    it("Should revert setPlatformFee above 10%", async function () {
        await expect(
            lazyMinting.setPlatformFee(1001)
        ).to.be.revertedWithCustomError(lazyMinting, "FeeTooHigh");
    });

    // Branch: setFeeRecipient with zero address
    it("Should revert setFeeRecipient with zero address", async function () {
        await expect(
            lazyMinting.setFeeRecipient(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(lazyMinting, "ZeroAddress");
    });

    // Branch: pause and unpause
    it("Should allow owner to pause and unpause", async function () {
        await lazyMinting.pause();
        await lazyMinting.unpause();
    });

    // Branch: setPlatformFee valid
    it("Should allow setting valid platform fee", async function () {
        await lazyMinting.setPlatformFee(500);
        expect(await lazyMinting.platformFee()).to.equal(500);
    });

    // Branch: setFeeRecipient valid
    it("Should allow setting valid fee recipient", async function () {
        await lazyMinting.setFeeRecipient(buyer.address);
        expect(await lazyMinting.feeRecipient()).to.equal(buyer.address);
    });

    // Branch: redeem with zero royalty (royaltyAmount == 0 path)
    it("Should handle redeem with zero royalty fee", async function () {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const block = await ethers.provider.getBlock("latest");
        const deadline = block.timestamp + 3600;

        const voucher = {
            tokenId: 0,
            price: ethers.parseEther("1"),
            uri: "ipfs://lazy/0",
            creator: creator.address,
            nftContract: await nftContract.getAddress(),
            royaltyFee: 0, // Zero royalty
            nonce: 0,
            deadline: deadline,
            chainId: chainId,
        };

        const domain = {
            name: "LazyMinting",
            version: "1",
            chainId: chainId,
            verifyingContract: await lazyMinting.getAddress(),
        };

        const types = {
            NFTVoucher: [
                { name: "tokenId", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "uri", type: "string" },
                { name: "creator", type: "address" },
                { name: "nftContract", type: "address" },
                { name: "royaltyFee", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
                { name: "chainId", type: "uint256" },
            ],
        };

        const signature = await creator.signTypedData(domain, types, voucher);
        await lazyMinting.connect(buyer).redeem(voucher, signature, { value: voucher.price });

        // Token should be minted to buyer
        expect(await nftContract.ownerOf(0)).to.equal(buyer.address);
    });

    // Branch: redeem with zero platform fee
    it("Should handle redeem with zero platform fee", async function () {
        const LazyMinting = await ethers.getContractFactory("LazyMinting");
        const zeroFeeLazy = await LazyMinting.deploy(0, owner.address);
        await zeroFeeLazy.authorizeContract(await nftContract.getAddress(), true);

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const block = await ethers.provider.getBlock("latest");
        const deadline = block.timestamp + 3600;

        const voucher = {
            tokenId: 1,
            price: ethers.parseEther("1"),
            uri: "ipfs://lazy/1",
            creator: creator.address,
            nftContract: await nftContract.getAddress(),
            royaltyFee: 500,
            nonce: 0,
            deadline: deadline,
            chainId: chainId,
        };

        const domain = {
            name: "LazyMinting",
            version: "1",
            chainId: chainId,
            verifyingContract: await zeroFeeLazy.getAddress(),
        };

        const types = {
            NFTVoucher: [
                { name: "tokenId", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "uri", type: "string" },
                { name: "creator", type: "address" },
                { name: "nftContract", type: "address" },
                { name: "royaltyFee", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
                { name: "chainId", type: "uint256" },
            ],
        };

        const signature = await creator.signTypedData(domain, types, voucher);
        await zeroFeeLazy.connect(buyer).redeem(voucher, signature, { value: voucher.price });

        expect(await nftContract.ownerOf(0)).to.equal(buyer.address);
    });
});

describe("Edge Cases: VickreyAuction", function () {
    let vickreyAuction, erc721;
    let owner, seller, bidder1, bidder2, bidder3;
    const PLATFORM_FEE = 250;
    const ONE_HOUR = 3600;
    const THIRTY_MINUTES = 1800;

    beforeEach(async function () {
        [owner, seller, bidder1, bidder2, bidder3] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, ethers.ZeroAddress, 0);

        const VickreyAuction = await ethers.getContractFactory("VickreyAuction");
        vickreyAuction = await VickreyAuction.deploy(PLATFORM_FEE, owner.address);

        await erc721.mint(seller.address, "ipfs://0");
        await erc721.mint(seller.address, "ipfs://1");
        await erc721.connect(seller).setApprovalForAll(await vickreyAuction.getAddress(), true);
    });

    // Branch: reclaimLosingBid — full happy path
    it("Should allow losing bidder to reclaim after settlement", async function () {
        const reservePrice = ethers.parseEther("1");
        await vickreyAuction.connect(seller).createAuction(
            await erc721.getAddress(), 0, reservePrice, ONE_HOUR, THIRTY_MINUTES
        );

        // Both bidders commit
        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        const salt1 = ethers.encodeBytes32String("salt1");
        const salt2 = ethers.encodeBytes32String("salt2");
        const hash1 = await vickreyAuction.getCommitmentHash(bid1, salt1);
        const hash2 = await vickreyAuction.getCommitmentHash(bid2, salt2);

        await vickreyAuction.connect(bidder1).commitBid(0, hash1, { value: bid1 });
        await vickreyAuction.connect(bidder2).commitBid(0, hash2, { value: bid2 });

        // Move to reveal phase
        await time.increase(ONE_HOUR + 1);

        // Both reveal
        await vickreyAuction.connect(bidder1).revealBid(0, bid1, salt1);
        await vickreyAuction.connect(bidder2).revealBid(0, bid2, salt2);

        // Move past reveal phase
        await time.increase(THIRTY_MINUTES + 1);

        // Settle
        await vickreyAuction.settle(0);

        // Losing bidder (bidder2) reclaims
        const balBefore = await ethers.provider.getBalance(bidder2.address);
        const tx = await vickreyAuction.connect(bidder2).reclaimLosingBid(0);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balAfter = await ethers.provider.getBalance(bidder2.address);

        expect(balAfter + gasUsed - balBefore).to.equal(bid2);
    });

    // Branch: reclaimLosingBid — auction not settled
    it("Should revert reclaimLosingBid before settlement", async function () {
        await vickreyAuction.connect(seller).createAuction(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
        );

        const bid = ethers.parseEther("2");
        const salt = ethers.encodeBytes32String("salt");
        const hash = await vickreyAuction.getCommitmentHash(bid, salt);
        await vickreyAuction.connect(bidder1).commitBid(0, hash, { value: bid });

        await time.increase(ONE_HOUR + 1);
        await vickreyAuction.connect(bidder1).revealBid(0, bid, salt);
        await time.increase(THIRTY_MINUTES + 1);

        // Not settled yet
        await expect(
            vickreyAuction.connect(bidder1).reclaimLosingBid(0)
        ).to.be.revertedWithCustomError(vickreyAuction, "AuctionNotSettled");
    });

    // Branch: reclaimLosingBid — unrevealed bidder
    it("Should revert reclaimLosingBid for unrevealed bidder", async function () {
        await vickreyAuction.connect(seller).createAuction(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
        );

        const bid1 = ethers.parseEther("3");
        const salt1 = ethers.encodeBytes32String("salt1");
        const hash1 = await vickreyAuction.getCommitmentHash(bid1, salt1);
        await vickreyAuction.connect(bidder1).commitBid(0, hash1, { value: bid1 });

        // bidder2 commits but doesn't reveal
        const bid2 = ethers.parseEther("2");
        const salt2 = ethers.encodeBytes32String("salt2");
        const hash2 = await vickreyAuction.getCommitmentHash(bid2, salt2);
        await vickreyAuction.connect(bidder2).commitBid(0, hash2, { value: bid2 });

        await time.increase(ONE_HOUR + 1);
        await vickreyAuction.connect(bidder1).revealBid(0, bid1, salt1);
        // bidder2 does NOT reveal

        await time.increase(THIRTY_MINUTES + 1);
        await vickreyAuction.settle(0);

        // bidder2 tries reclaimLosingBid but didn't reveal
        await expect(
            vickreyAuction.connect(bidder2).reclaimLosingBid(0)
        ).to.be.revertedWithCustomError(vickreyAuction, "NotBidder");
    });

    // Branch: reclaimLosingBid — winner tries to reclaim
    it("Should revert reclaimLosingBid by winner", async function () {
        await vickreyAuction.connect(seller).createAuction(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
        );

        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        const salt1 = ethers.encodeBytes32String("s1");
        const salt2 = ethers.encodeBytes32String("s2");

        await vickreyAuction.connect(bidder1).commitBid(0, await vickreyAuction.getCommitmentHash(bid1, salt1), { value: bid1 });
        await vickreyAuction.connect(bidder2).commitBid(0, await vickreyAuction.getCommitmentHash(bid2, salt2), { value: bid2 });

        await time.increase(ONE_HOUR + 1);
        await vickreyAuction.connect(bidder1).revealBid(0, bid1, salt1);
        await vickreyAuction.connect(bidder2).revealBid(0, bid2, salt2);

        await time.increase(THIRTY_MINUTES + 1);
        await vickreyAuction.settle(0);

        // Winner (bidder1) tries to use reclaimLosingBid
        await expect(
            vickreyAuction.connect(bidder1).reclaimLosingBid(0)
        ).to.be.revertedWithCustomError(vickreyAuction, "WinnerCannotReclaim");
    });

    // Branch: reclaimLosingBid — double reclaim
    it("Should revert double reclaimLosingBid", async function () {
        await vickreyAuction.connect(seller).createAuction(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
        );

        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        const salt1 = ethers.encodeBytes32String("s1");
        const salt2 = ethers.encodeBytes32String("s2");

        await vickreyAuction.connect(bidder1).commitBid(0, await vickreyAuction.getCommitmentHash(bid1, salt1), { value: bid1 });
        await vickreyAuction.connect(bidder2).commitBid(0, await vickreyAuction.getCommitmentHash(bid2, salt2), { value: bid2 });

        await time.increase(ONE_HOUR + 1);
        await vickreyAuction.connect(bidder1).revealBid(0, bid1, salt1);
        await vickreyAuction.connect(bidder2).revealBid(0, bid2, salt2);

        await time.increase(THIRTY_MINUTES + 1);
        await vickreyAuction.settle(0);

        await vickreyAuction.connect(bidder2).reclaimLosingBid(0);
        await expect(
            vickreyAuction.connect(bidder2).reclaimLosingBid(0)
        ).to.be.revertedWithCustomError(vickreyAuction, "AlreadyReclaimed");
    });

    // Branch: setPlatformFee above 10%
    it("Should revert setPlatformFee above 10%", async function () {
        await expect(
            vickreyAuction.setPlatformFee(1001)
        ).to.be.revertedWithCustomError(vickreyAuction, "FeeTooHigh");
    });

    // Branch: setFeeRecipient with zero address
    it("Should revert setFeeRecipient with zero address", async function () {
        await expect(
            vickreyAuction.setFeeRecipient(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(vickreyAuction, "ZeroAddress");
    });

    // Branch: unpause
    it("Should allow owner to unpause", async function () {
        await vickreyAuction.pause();
        await vickreyAuction.unpause();
    });
});

describe("Edge Cases: MarketplaceV2", function () {
    let marketplaceV2, erc721, erc1155, mockToken, noRoyaltyNft;
    let owner, admin, seller, buyer, royaltyReceiver;
    const PLATFORM_FEE = 250;
    const ROYALTY_FEE = 500;

    beforeEach(async function () {
        [owner, admin, seller, buyer, royaltyReceiver] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE);

        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        erc1155 = await ERC1155NFT.deploy("TestMulti", "TMT", "ipfs://base/", royaltyReceiver.address, ROYALTY_FEE);

        const MockERC721NoRoyalty = await ethers.getContractFactory("MockERC721NoRoyalty");
        noRoyaltyNft = await MockERC721NoRoyalty.deploy();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("MockToken", "MTK", ethers.parseEther("1000000"));
        await mockToken.transfer(buyer.address, ethers.parseEther("10000"));

        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const implementation = await MarketplaceV2.deploy();
        await implementation.waitForDeployment();

        const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
        const initData = MarketplaceV2.interface.encodeFunctionData("initialize", [
            PLATFORM_FEE, owner.address, admin.address
        ]);
        const proxy = await ERC1967Proxy.deploy(await implementation.getAddress(), initData);
        await proxy.waitForDeployment();
        marketplaceV2 = MarketplaceV2.attach(await proxy.getAddress());

        await erc721.mint(seller.address, "ipfs://0");
        await erc721.mint(seller.address, "ipfs://1");
        await erc1155.mint(seller.address, 100, "ipfs://multi/0");
        await noRoyaltyNft.connect(seller).mint(seller.address);

        await erc721.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);
        await erc1155.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);
        await noRoyaltyNft.connect(seller).setApprovalForAll(await marketplaceV2.getAddress(), true);
        await marketplaceV2.connect(admin).setAcceptedToken(await mockToken.getAddress(), true);
    });

    // Branch: ERC20 buy of ERC1155 listing
    it("Should buy ERC1155 listing with ERC20 tokens", async function () {
        const price = ethers.parseEther("10");
        await marketplaceV2.connect(seller).listERC1155(
            await erc1155.getAddress(), 0, 50, price, await mockToken.getAddress()
        );

        await mockToken.connect(buyer).approve(await marketplaceV2.getAddress(), price);
        await mine(1);
        await marketplaceV2.connect(buyer).buyWithToken(0, await mockToken.getAddress());

        expect(await erc1155.balanceOf(buyer.address, 0)).to.equal(50);
    });

    // Branch: cancel ERC1155 listing
    it("Should cancel ERC1155 listing and return tokens", async function () {
        await marketplaceV2.connect(seller).listERC1155(
            await erc1155.getAddress(), 0, 50, ethers.parseEther("1"), ethers.ZeroAddress
        );
        await marketplaceV2.connect(seller).cancelListing(0);
        expect(await erc1155.balanceOf(seller.address, 0)).to.equal(100);
    });

    // Branch: scheduleUpgrade with zero address
    it("Should revert scheduleUpgrade with zero address", async function () {
        await expect(
            marketplaceV2.connect(admin).scheduleUpgrade(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(marketplaceV2, "ZeroAddress");
    });

    // Branch: _authorizeUpgrade without scheduling
    it("Should revert upgrade without scheduling", async function () {
        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const newImpl = await MarketplaceV2.deploy();

        await expect(
            marketplaceV2.connect(admin).upgradeToAndCall(await newImpl.getAddress(), "0x")
        ).to.be.revertedWithCustomError(marketplaceV2, "UpgradeNotScheduled");
    });

    // Branch: _authorizeUpgrade before timelock expires
    it("Should revert upgrade before timelock expires", async function () {
        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const newImpl = await MarketplaceV2.deploy();

        await marketplaceV2.connect(admin).scheduleUpgrade(await newImpl.getAddress());

        // Try immediately (before 2-day delay)
        await expect(
            marketplaceV2.connect(admin).upgradeToAndCall(await newImpl.getAddress(), "0x")
        ).to.be.revertedWithCustomError(marketplaceV2, "UpgradeTooEarly");
    });

    // Branch: withdrawFunds — nothing to withdraw
    it("Should revert withdrawFunds with no pending balance", async function () {
        await expect(
            marketplaceV2.connect(buyer).withdrawFunds()
        ).to.be.revertedWithCustomError(marketplaceV2, "NothingToWithdraw");
    });

    // Branch: ETH buy distributes properly with pending withdrawals for seller
    it("Should add seller amount to pendingWithdrawals on ETH buy", async function () {
        await marketplaceV2.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
        );
        await mine(1);
        await marketplaceV2.connect(buyer).buy(0, { value: ethers.parseEther("1") });

        const pending = await marketplaceV2.pendingWithdrawals(seller.address);
        expect(pending).to.be.gt(0);
    });

    // Branch: successful withdrawFunds
    it("Should allow successful withdrawFunds after sale", async function () {
        await marketplaceV2.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
        );
        await mine(1);
        await marketplaceV2.connect(buyer).buy(0, { value: ethers.parseEther("1") });

        const pending = await marketplaceV2.pendingWithdrawals(seller.address);
        await marketplaceV2.connect(seller).withdrawFunds();
        expect(await marketplaceV2.pendingWithdrawals(seller.address)).to.equal(0);
    });

    // Branch: non-ERC2981 NFT in ERC20 sale path
    it("Should handle ERC20 buy of non-ERC2981 NFT", async function () {
        await marketplaceV2.connect(seller).listERC721(
            await noRoyaltyNft.getAddress(), 0, ethers.parseEther("10"), await mockToken.getAddress()
        );

        await mockToken.connect(buyer).approve(await marketplaceV2.getAddress(), ethers.parseEther("10"));
        await mine(1);
        await marketplaceV2.connect(buyer).buyWithToken(0, await mockToken.getAddress());

        expect(await noRoyaltyNft.ownerOf(0)).to.equal(buyer.address);
    });

    // Branch: updatePrice with zero price
    it("Should revert updatePrice with zero price", async function () {
        await marketplaceV2.connect(seller).listERC721(
            await erc721.getAddress(), 0, ethers.parseEther("1"), ethers.ZeroAddress
        );
        await expect(
            marketplaceV2.connect(seller).updatePrice(0, 0)
        ).to.be.revertedWithCustomError(marketplaceV2, "InvalidPrice");
    });

    // Branch: cancelUpgrade
    it("Should cancel a scheduled upgrade", async function () {
        const MarketplaceV2 = await ethers.getContractFactory("MarketplaceV2");
        const newImpl = await MarketplaceV2.deploy();

        await marketplaceV2.connect(admin).scheduleUpgrade(await newImpl.getAddress());
        await marketplaceV2.connect(admin).cancelUpgrade(await newImpl.getAddress());

        // Now trying to upgrade should revert
        await time.increase(3 * 24 * 60 * 60); // 3 days
        await expect(
            marketplaceV2.connect(admin).upgradeToAndCall(await newImpl.getAddress(), "0x")
        ).to.be.revertedWithCustomError(marketplaceV2, "UpgradeNotScheduled");
    });
});
