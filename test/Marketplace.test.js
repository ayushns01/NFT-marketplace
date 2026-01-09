const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
    let marketplace;
    let erc721;
    let erc1155;
    let owner;
    let seller;
    let buyer;
    let royaltyReceiver;

    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;  // 5%

    beforeEach(async function () {
        [owner, seller, buyer, royaltyReceiver] = await ethers.getSigners();

        // Deploy ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy(
            "TestNFT",
            "TNFT",
            10000,
            royaltyReceiver.address,
            ROYALTY_FEE
        );

        // Deploy ERC1155
        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        erc1155 = await ERC1155NFT.deploy(
            "TestMulti",
            "TMT",
            "ipfs://base/",
            royaltyReceiver.address,
            ROYALTY_FEE
        );

        // Deploy Marketplace
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(PLATFORM_FEE, owner.address);

        // Mint NFTs to seller
        await erc721.mint(seller.address, "ipfs://token/0");
        await erc721.mint(seller.address, "ipfs://token/1");
        await erc1155.mint(seller.address, 100, "ipfs://multi/0");

        // Approve marketplace
        await erc721.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await erc1155.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
    });

    describe("Deployment", function () {
        it("Should set correct platform fee", async function () {
            expect(await marketplace.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await marketplace.feeRecipient()).to.equal(owner.address);
        });

        it("Should start with zero listings", async function () {
            expect(await marketplace.getTotalListings()).to.equal(0);
        });
    });

    describe("ERC721 Listing", function () {
        it("Should list an ERC721 token", async function () {
            const price = ethers.parseEther("1");
            
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                price
            );

            const listing = await marketplace.getListing(0);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.price).to.equal(price);
            expect(listing.status).to.equal(0); // Active
        });

        it("Should transfer NFT to marketplace on listing", async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );

            expect(await erc721.ownerOf(0)).to.equal(await marketplace.getAddress());
        });

        it("Should fail to list with zero price", async function () {
            await expect(
                marketplace.connect(seller).listERC721(
                    await erc721.getAddress(),
                    0,
                    0
                )
            ).to.be.revertedWithCustomError(marketplace, "InvalidPrice");
        });

        it("Should fail to list token not owned", async function () {
            await expect(
                marketplace.connect(buyer).listERC721(
                    await erc721.getAddress(),
                    0,
                    ethers.parseEther("1")
                )
            ).to.be.revertedWithCustomError(marketplace, "NotTokenOwner");
        });
    });

    describe("ERC1155 Listing", function () {
        it("Should list ERC1155 tokens", async function () {
            const price = ethers.parseEther("0.5");
            
            await marketplace.connect(seller).listERC1155(
                await erc1155.getAddress(),
                0,
                50,
                price
            );

            const listing = await marketplace.getListing(0);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.amount).to.equal(50);
            expect(listing.price).to.equal(price);
        });

        it("Should transfer tokens to marketplace", async function () {
            await marketplace.connect(seller).listERC1155(
                await erc1155.getAddress(),
                0,
                50,
                ethers.parseEther("0.5")
            );

            expect(await erc1155.balanceOf(await marketplace.getAddress(), 0)).to.equal(50);
            expect(await erc1155.balanceOf(seller.address, 0)).to.equal(50);
        });
    });

    describe("Buying", function () {
        beforeEach(async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );
        });

        it("Should allow buying at listed price", async function () {
            await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });

            expect(await erc721.ownerOf(0)).to.equal(buyer.address);
            
            const listing = await marketplace.getListing(0);
            expect(listing.status).to.equal(1); // Sold
        });

        it("Should distribute fees correctly", async function () {
            const price = ethers.parseEther("1");
            const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;
            const royaltyAmount = (price * BigInt(ROYALTY_FEE)) / 10000n;
            const sellerAmount = price - platformAmount - royaltyAmount;

            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
            const royaltyBalanceBefore = await ethers.provider.getBalance(royaltyReceiver.address);

            await marketplace.connect(buyer).buy(0, { value: price });

            const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            const royaltyBalanceAfter = await ethers.provider.getBalance(royaltyReceiver.address);

            expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(sellerAmount);
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(platformAmount);
            expect(royaltyBalanceAfter - royaltyBalanceBefore).to.equal(royaltyAmount);
        });

        it("Should fail with insufficient payment", async function () {
            await expect(
                marketplace.connect(buyer).buy(0, { value: ethers.parseEther("0.5") })
            ).to.be.revertedWithCustomError(marketplace, "InsufficientPayment");
        });

        it("Should fail to buy already sold listing", async function () {
            await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });

            await expect(
                marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(marketplace, "ListingNotActive");
        });
    });

    describe("Cancel Listing", function () {
        beforeEach(async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );
        });

        it("Should allow seller to cancel", async function () {
            await marketplace.connect(seller).cancelListing(0);

            const listing = await marketplace.getListing(0);
            expect(listing.status).to.equal(2); // Cancelled
        });

        it("Should return NFT to seller on cancel", async function () {
            await marketplace.connect(seller).cancelListing(0);
            expect(await erc721.ownerOf(0)).to.equal(seller.address);
        });

        it("Should fail if not seller", async function () {
            await expect(
                marketplace.connect(buyer).cancelListing(0)
            ).to.be.revertedWithCustomError(marketplace, "NotSeller");
        });
    });

    describe("Update Price", function () {
        beforeEach(async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );
        });

        it("Should allow seller to update price", async function () {
            const newPrice = ethers.parseEther("2");
            await marketplace.connect(seller).updatePrice(0, newPrice);

            const listing = await marketplace.getListing(0);
            expect(listing.price).to.equal(newPrice);
        });

        it("Should fail if not seller", async function () {
            await expect(
                marketplace.connect(buyer).updatePrice(0, ethers.parseEther("2"))
            ).to.be.revertedWithCustomError(marketplace, "NotSeller");
        });
    });

    describe("Offers", function () {
        beforeEach(async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );
        });

        it("Should allow making an offer", async function () {
            const offerPrice = ethers.parseEther("0.8");
            const expiresAt = Math.floor(Date.now() / 1000) + 86400;

            await marketplace.connect(buyer).makeOffer(0, expiresAt, { value: offerPrice });

            const offers = await marketplace.getOffers(0);
            expect(offers.length).to.equal(1);
            expect(offers[0].buyer).to.equal(buyer.address);
            expect(offers[0].price).to.equal(offerPrice);
        });

        it("Should allow seller to accept offer", async function () {
            const offerPrice = ethers.parseEther("0.8");
            await marketplace.connect(buyer).makeOffer(0, 0, { value: offerPrice });

            await marketplace.connect(seller).acceptOffer(0, 0);

            expect(await erc721.ownerOf(0)).to.equal(buyer.address);
        });

        it("Should allow buyer to cancel offer", async function () {
            const offerPrice = ethers.parseEther("0.8");
            await marketplace.connect(buyer).makeOffer(0, 0, { value: offerPrice });

            const balanceBefore = await ethers.provider.getBalance(buyer.address);
            const tx = await marketplace.connect(buyer).cancelOffer(0, 0);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(buyer.address);

            expect(balanceAfter + gasUsed - balanceBefore).to.equal(offerPrice);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set platform fee", async function () {
            await marketplace.setPlatformFee(500);
            expect(await marketplace.platformFee()).to.equal(500);
        });

        it("Should not allow fee above 10%", async function () {
            await expect(
                marketplace.setPlatformFee(1001)
            ).to.be.revertedWith("Fee too high");
        });

        it("Should allow owner to set fee recipient", async function () {
            await marketplace.setFeeRecipient(buyer.address);
            expect(await marketplace.feeRecipient()).to.equal(buyer.address);
        });

        it("Should allow owner to pause", async function () {
            await marketplace.pause();
            
            await expect(
                marketplace.connect(seller).listERC721(
                    await erc721.getAddress(),
                    1,
                    ethers.parseEther("1")
                )
            ).to.be.revertedWithCustomError(marketplace, "EnforcedPause");
        });
    });

    describe("View Functions", function () {
        it("Should return user listings", async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                1,
                ethers.parseEther("2")
            );

            const userListings = await marketplace.getUserListings(seller.address);
            expect(userListings.length).to.equal(2);
        });

        it("Should return total listings", async function () {
            await marketplace.connect(seller).listERC721(
                await erc721.getAddress(),
                0,
                ethers.parseEther("1")
            );

            expect(await marketplace.getTotalListings()).to.equal(1);
        });
    });
});
