const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VickreyAuction", function () {
    let vickreyAuction;
    let erc721;
    let owner;
    let seller;
    let bidder1;
    let bidder2;
    let bidder3;
    let royaltyReceiver;

    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;
    const ONE_HOUR = 3600;
    const THIRTY_MINUTES = 1800;

    beforeEach(async function () {
        [owner, seller, bidder1, bidder2, bidder3, royaltyReceiver] = await ethers.getSigners();

        // Deploy ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        erc721 = await ERC721NFT.deploy(
            "TestNFT", "TNFT", 10000, royaltyReceiver.address, ROYALTY_FEE
        );

        // Deploy VickreyAuction
        const VickreyAuction = await ethers.getContractFactory("VickreyAuction");
        vickreyAuction = await VickreyAuction.deploy(PLATFORM_FEE, owner.address);

        // Mint NFTs to seller
        await erc721.mint(seller.address, "ipfs://token/0");
        await erc721.mint(seller.address, "ipfs://token/1");
        await erc721.mint(seller.address, "ipfs://token/2");

        // Approve auction contract
        await erc721.connect(seller).setApprovalForAll(await vickreyAuction.getAddress(), true);
    });

    describe("Deployment", function () {
        it("Should set correct platform fee", async function () {
            expect(await vickreyAuction.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await vickreyAuction.feeRecipient()).to.equal(owner.address);
        });

        it("Should set minimum durations", async function () {
            expect(await vickreyAuction.minCommitDuration()).to.equal(ONE_HOUR);
            expect(await vickreyAuction.minRevealDuration()).to.equal(THIRTY_MINUTES);
        });
    });

    describe("Auction Creation", function () {
        it("Should create a Vickrey auction", async function () {
            const reservePrice = ethers.parseEther("1");

            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, reservePrice, ONE_HOUR, THIRTY_MINUTES
            );

            const auction = await vickreyAuction.getAuction(0);
            expect(auction.seller).to.equal(seller.address);
            expect(auction.reservePrice).to.equal(reservePrice);
            expect(auction.settled).to.equal(false);
        });

        it("Should transfer NFT to auction contract", async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );

            expect(await erc721.ownerOf(0)).to.equal(await vickreyAuction.getAddress());
        });

        it("Should fail with short commit duration", async function () {
            await expect(
                vickreyAuction.connect(seller).createAuction(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), 60, THIRTY_MINUTES
                )
            ).to.be.revertedWithCustomError(vickreyAuction, "InvalidDuration");
        });

        it("Should fail with short reveal duration", async function () {
            await expect(
                vickreyAuction.connect(seller).createAuction(
                    await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, 60
                )
            ).to.be.revertedWithCustomError(vickreyAuction, "InvalidDuration");
        });

        it("Should fail with zero address NFT contract", async function () {
            await expect(
                vickreyAuction.connect(seller).createAuction(
                    ethers.ZeroAddress, 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
                )
            ).to.be.revertedWithCustomError(vickreyAuction, "ZeroAddress");
        });
    });

    describe("Commit Phase", function () {
        let auctionId;

        beforeEach(async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );
            auctionId = 0;
        });

        it("Should accept valid commitment", async function () {
            const bid = ethers.parseEther("2");
            const salt = ethers.randomBytes(32);
            const commitmentHash = await vickreyAuction.getCommitmentHash(bid, salt);

            await vickreyAuction.connect(bidder1).commitBid(auctionId, commitmentHash, { value: bid });

            const commitment = await vickreyAuction.commitments(auctionId, bidder1.address);
            expect(commitment.hash).to.equal(commitmentHash);
            expect(commitment.deposit).to.equal(bid);
            expect(commitment.revealed).to.equal(false);
        });

        it("Should reject commitment with insufficient deposit", async function () {
            const bid = ethers.parseEther("0.5"); // Less than reserve price
            const salt = ethers.randomBytes(32);
            const commitmentHash = await vickreyAuction.getCommitmentHash(bid, salt);

            await expect(
                vickreyAuction.connect(bidder1).commitBid(auctionId, commitmentHash, { value: bid })
            ).to.be.revertedWithCustomError(vickreyAuction, "InsufficientDeposit");
        });

        it("Should reject duplicate commitment", async function () {
            const bid = ethers.parseEther("2");
            const salt = ethers.randomBytes(32);
            const commitmentHash = await vickreyAuction.getCommitmentHash(bid, salt);

            await vickreyAuction.connect(bidder1).commitBid(auctionId, commitmentHash, { value: bid });

            await expect(
                vickreyAuction.connect(bidder1).commitBid(auctionId, commitmentHash, { value: bid })
            ).to.be.revertedWithCustomError(vickreyAuction, "AlreadyCommitted");
        });

        it("Should track phase correctly as Commit", async function () {
            const phase = await vickreyAuction.getPhase(auctionId);
            expect(phase).to.equal(1); // Commit phase
        });

        it("Should reject commitment after commit phase ends", async function () {
            await time.increase(ONE_HOUR + 1);

            const bid = ethers.parseEther("2");
            const salt = ethers.randomBytes(32);
            const commitmentHash = await vickreyAuction.getCommitmentHash(bid, salt);

            await expect(
                vickreyAuction.connect(bidder1).commitBid(auctionId, commitmentHash, { value: bid })
            ).to.be.revertedWithCustomError(vickreyAuction, "AuctionNotInPhase");
        });
    });

    describe("Reveal Phase", function () {
        let auctionId;
        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        let salt1, salt2;

        beforeEach(async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );
            auctionId = 0;

            salt1 = ethers.randomBytes(32);
            salt2 = ethers.randomBytes(32);

            const hash1 = await vickreyAuction.getCommitmentHash(bid1, salt1);
            const hash2 = await vickreyAuction.getCommitmentHash(bid2, salt2);

            await vickreyAuction.connect(bidder1).commitBid(auctionId, hash1, { value: bid1 });
            await vickreyAuction.connect(bidder2).commitBid(auctionId, hash2, { value: bid2 });

            // Move to reveal phase
            await time.increase(ONE_HOUR + 1);
        });

        it("Should accept valid reveal", async function () {
            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);

            const auction = await vickreyAuction.getAuction(auctionId);
            expect(auction.highestBidder).to.equal(bidder1.address);
            expect(auction.highestBid).to.equal(bid1);
        });

        it("Should track highest and second-highest bids", async function () {
            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);
            await vickreyAuction.connect(bidder2).revealBid(auctionId, bid2, salt2);

            const auction = await vickreyAuction.getAuction(auctionId);
            expect(auction.highestBidder).to.equal(bidder1.address);
            expect(auction.highestBid).to.equal(bid1);
            expect(auction.secondHighestBid).to.equal(bid2);
        });

        it("Should reject reveal with wrong hash", async function () {
            const wrongBid = ethers.parseEther("999");

            await expect(
                vickreyAuction.connect(bidder1).revealBid(auctionId, wrongBid, salt1)
            ).to.be.revertedWithCustomError(vickreyAuction, "InvalidReveal");
        });

        it("Should reject reveal with wrong salt", async function () {
            const wrongSalt = ethers.randomBytes(32);

            await expect(
                vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, wrongSalt)
            ).to.be.revertedWithCustomError(vickreyAuction, "InvalidReveal");
        });

        it("Should reject reveal from non-bidder", async function () {
            await expect(
                vickreyAuction.connect(bidder3).revealBid(auctionId, bid1, salt1)
            ).to.be.revertedWithCustomError(vickreyAuction, "NotBidder");
        });

        it("Should reject reveal with bid greater than deposit", async function () {
            // This test needs its own auction with bidder3 commitment during COMMIT phase
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 1, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );
            
            const overBid = ethers.parseEther("10");
            const overSalt = ethers.randomBytes(32);
            const overHash = await vickreyAuction.getCommitmentHash(overBid, overSalt);

            // Commit with less than claimed bid (during COMMIT phase for new auction)
            await vickreyAuction.connect(bidder3).commitBid(1, overHash, { value: ethers.parseEther("2") });

            // Move to reveal phase
            await time.increase(ONE_HOUR + 1);

            // Reveal should fail because revealed bid > deposit
            await expect(
                vickreyAuction.connect(bidder3).revealBid(1, overBid, overSalt)
            ).to.be.revertedWithCustomError(vickreyAuction, "InvalidReveal");
        });

        it("Should track phase correctly as Reveal", async function () {
            const phase = await vickreyAuction.getPhase(auctionId);
            expect(phase).to.equal(2); // Reveal phase
        });

        it("Should add excess deposit to pending withdrawals", async function () {
            // Bidder1 deposited bid1 but will only pay second-highest price on settlement
            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);

            // No excess yet - excess is calculated on settlement
            // But reveal should add (deposit - bid) if deposit > revealed bid
            // In this case deposit == bid, so no excess
            const pending = await vickreyAuction.pendingWithdrawals(bidder1.address);
            expect(pending).to.equal(0);
        });
    });

    describe("Settlement", function () {
        let auctionId;
        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        let salt1, salt2;

        beforeEach(async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );
            auctionId = 0;

            salt1 = ethers.randomBytes(32);
            salt2 = ethers.randomBytes(32);

            const hash1 = await vickreyAuction.getCommitmentHash(bid1, salt1);
            const hash2 = await vickreyAuction.getCommitmentHash(bid2, salt2);

            await vickreyAuction.connect(bidder1).commitBid(auctionId, hash1, { value: bid1 });
            await vickreyAuction.connect(bidder2).commitBid(auctionId, hash2, { value: bid2 });

            await time.increase(ONE_HOUR + 1);

            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);
            await vickreyAuction.connect(bidder2).revealBid(auctionId, bid2, salt2);

            await time.increase(THIRTY_MINUTES + 1);
        });

        it("Should settle auction with second-price payment", async function () {
            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

            await vickreyAuction.settle(auctionId);

            // Winner is bidder1 (bid 3 ETH), pays second-highest (2 ETH)
            expect(await erc721.ownerOf(0)).to.equal(bidder1.address);

            const auction = await vickreyAuction.getAuction(auctionId);
            expect(auction.settled).to.equal(true);
        });

        it("Should distribute funds correctly (Vickrey mechanism)", async function () {
            const paidPrice = bid2; // Second-highest bid
            const fee = (paidPrice * BigInt(PLATFORM_FEE)) / 10000n;
            const sellerProceeds = paidPrice - fee;

            await vickreyAuction.settle(auctionId);

            // Payments now use pull-pattern - check pending withdrawals
            const sellerPending = await vickreyAuction.pendingWithdrawals(seller.address);
            const ownerPending = await vickreyAuction.pendingWithdrawals(owner.address);

            expect(sellerPending).to.equal(sellerProceeds);
            expect(ownerPending).to.equal(fee);

            // Verify withdrawals work correctly
            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
            const tx = await vickreyAuction.connect(seller).withdraw();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
            
            expect(sellerBalanceAfter - sellerBalanceBefore + gasUsed).to.equal(sellerProceeds);
        });

        it("Should refund winner excess (bid - paid price)", async function () {
            await vickreyAuction.settle(auctionId);

            // Bidder1 bid 3 ETH, paid 2 ETH (second-highest)
            const winnerRefund = bid1 - bid2;
            const pending = await vickreyAuction.pendingWithdrawals(bidder1.address);
            expect(pending).to.equal(winnerRefund);
        });

        it("Should fail to settle before reveal phase ends", async function () {
            // Create new auction and try to settle early
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 1, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );

            await expect(
                vickreyAuction.settle(1)
            ).to.be.revertedWithCustomError(vickreyAuction, "AuctionNotInPhase");
        });

        it("Should fail to settle already settled auction", async function () {
            await vickreyAuction.settle(auctionId);

            await expect(
                vickreyAuction.settle(auctionId)
            ).to.be.revertedWithCustomError(vickreyAuction, "AlreadySettled");
        });

        it("Should return NFT to seller if no bids", async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 1, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );

            await time.increase(ONE_HOUR + THIRTY_MINUTES + 2);

            await vickreyAuction.settle(1);

            expect(await erc721.ownerOf(1)).to.equal(seller.address);
        });

        it("Should return NFT to seller if reserve not met", async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 1, ethers.parseEther("5"), ONE_HOUR, THIRTY_MINUTES
            );

            // Deposit must be >= reserve price, but revealed bid can be lower
            const lowBid = ethers.parseEther("2");
            const depositAmount = ethers.parseEther("5"); // Deposit equals reserve to pass commitment
            const salt = ethers.randomBytes(32);
            const hash = await vickreyAuction.getCommitmentHash(lowBid, salt);

            await vickreyAuction.connect(bidder3).commitBid(1, hash, { value: depositAmount });

            await time.increase(ONE_HOUR + 1);
            await vickreyAuction.connect(bidder3).revealBid(1, lowBid, salt);

            await time.increase(THIRTY_MINUTES + 1);
            await vickreyAuction.settle(1);

            // NFT returns to seller because highest bid (2 ETH) < reserve (5 ETH)
            expect(await erc721.ownerOf(1)).to.equal(seller.address);
        });
    });

    describe("Withdrawals", function () {
        it("Should allow withdrawing pending returns", async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );

            const bid1 = ethers.parseEther("3");
            const bid2 = ethers.parseEther("2");
            const salt1 = ethers.randomBytes(32);
            const salt2 = ethers.randomBytes(32);

            await vickreyAuction.connect(bidder1).commitBid(0, await vickreyAuction.getCommitmentHash(bid1, salt1), { value: bid1 });
            await vickreyAuction.connect(bidder2).commitBid(0, await vickreyAuction.getCommitmentHash(bid2, salt2), { value: bid2 });

            await time.increase(ONE_HOUR + 1);

            await vickreyAuction.connect(bidder1).revealBid(0, bid1, salt1);
            await vickreyAuction.connect(bidder2).revealBid(0, bid2, salt2);

            await time.increase(THIRTY_MINUTES + 1);
            await vickreyAuction.settle(0);

            // Bidder1 should have refund (bid1 - bid2)
            const expectedRefund = bid1 - bid2;
            const balanceBefore = await ethers.provider.getBalance(bidder1.address);

            const tx = await vickreyAuction.connect(bidder1).withdraw();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balanceAfter = await ethers.provider.getBalance(bidder1.address);
            expect(balanceAfter + gasUsed - balanceBefore).to.equal(expectedRefund);
        });

        it("Should fail if nothing to withdraw", async function () {
            await expect(
                vickreyAuction.connect(bidder1).withdraw()
            ).to.be.revertedWithCustomError(vickreyAuction, "NothingToWithdraw");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set platform fee", async function () {
            await vickreyAuction.setPlatformFee(500);
            expect(await vickreyAuction.platformFee()).to.equal(500);
        });

        it("Should not allow fee above 10%", async function () {
            await expect(
                vickreyAuction.setPlatformFee(1001)
            ).to.be.revertedWithCustomError(vickreyAuction, "FeeTooHigh");
        });

        it("Should allow owner to set fee recipient", async function () {
            await vickreyAuction.setFeeRecipient(bidder1.address);
            expect(await vickreyAuction.feeRecipient()).to.equal(bidder1.address);
        });

        it("Should allow owner to pause", async function () {
            await vickreyAuction.pause();

            await expect(
                vickreyAuction.connect(seller).createAuction(
                    await erc721.getAddress(), 2, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
                )
            ).to.be.revertedWithCustomError(vickreyAuction, "EnforcedPause");
        });

        it("Should allow owner to unpause", async function () {
            await vickreyAuction.pause();
            await vickreyAuction.unpause();

            await expect(
                vickreyAuction.connect(seller).createAuction(
                    await erc721.getAddress(), 2, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
                )
            ).to.not.be.reverted;
        });
    });

    describe("Helper Functions", function () {
        it("Should generate correct commitment hash", async function () {
            const bid = ethers.parseEther("1");
            const salt = ethers.id("test-salt");

            const contractHash = await vickreyAuction.getCommitmentHash(bid, salt);
            const expectedHash = ethers.keccak256(ethers.solidityPacked(["uint256", "bytes32"], [bid, salt]));

            expect(contractHash).to.equal(expectedHash);
        });
    });

    describe("Unrevealed Deposit Recovery", function () {
        let auctionId;
        const bid1 = ethers.parseEther("3");
        const bid2 = ethers.parseEther("2");
        let salt1, salt2;

        beforeEach(async function () {
            await vickreyAuction.connect(seller).createAuction(
                await erc721.getAddress(), 0, ethers.parseEther("1"), ONE_HOUR, THIRTY_MINUTES
            );
            auctionId = 0;

            salt1 = ethers.randomBytes(32);
            salt2 = ethers.randomBytes(32);

            const hash1 = await vickreyAuction.getCommitmentHash(bid1, salt1);
            const hash2 = await vickreyAuction.getCommitmentHash(bid2, salt2);

            // Both bidders commit
            await vickreyAuction.connect(bidder1).commitBid(auctionId, hash1, { value: bid1 });
            await vickreyAuction.connect(bidder2).commitBid(auctionId, hash2, { value: bid2 });
        });

        it("Should allow unrevealed bidder to reclaim deposit after auction ends", async function () {
            // Move to reveal phase
            await time.increase(ONE_HOUR + 1);

            // Only bidder1 reveals
            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);

            // Move past reveal phase (auction ends)
            await time.increase(THIRTY_MINUTES + 1);

            // bidder2 didn't reveal, can now reclaim
            const balanceBefore = await ethers.provider.getBalance(bidder2.address);
            const tx = await vickreyAuction.connect(bidder2).reclaimUnrevealedDeposit(auctionId);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(bidder2.address);

            expect(balanceAfter + gasUsed - balanceBefore).to.equal(bid2);

            await expect(tx).to.emit(vickreyAuction, "UnrevealedDepositReclaimed")
                .withArgs(auctionId, bidder2.address, bid2);
        });

        it("Should revert if auction not ended", async function () {
            // Still in commit phase
            await expect(
                vickreyAuction.connect(bidder2).reclaimUnrevealedDeposit(auctionId)
            ).to.be.revertedWithCustomError(vickreyAuction, "AuctionNotEnded");
        });

        it("Should revert if bidder already revealed", async function () {
            // Move to reveal phase
            await time.increase(ONE_HOUR + 1);

            // bidder1 reveals
            await vickreyAuction.connect(bidder1).revealBid(auctionId, bid1, salt1);

            // Move past reveal phase
            await time.increase(THIRTY_MINUTES + 1);

            // bidder1 cannot reclaim (already revealed)
            await expect(
                vickreyAuction.connect(bidder1).reclaimUnrevealedDeposit(auctionId)
            ).to.be.revertedWithCustomError(vickreyAuction, "AlreadyRevealed");
        });

        it("Should revert if no deposit to reclaim", async function () {
            // Move past auction end
            await time.increase(ONE_HOUR + THIRTY_MINUTES + 2);

            // bidder3 never committed
            await expect(
                vickreyAuction.connect(bidder3).reclaimUnrevealedDeposit(auctionId)
            ).to.be.revertedWithCustomError(vickreyAuction, "NoDepositToReclaim");
        });

        it("Should prevent double reclaim", async function () {
            // Move past auction end
            await time.increase(ONE_HOUR + THIRTY_MINUTES + 2);

            // First reclaim succeeds
            await vickreyAuction.connect(bidder2).reclaimUnrevealedDeposit(auctionId);

            // Second reclaim fails
            await expect(
                vickreyAuction.connect(bidder2).reclaimUnrevealedDeposit(auctionId)
            ).to.be.revertedWithCustomError(vickreyAuction, "NoDepositToReclaim");
        });
    });
});
