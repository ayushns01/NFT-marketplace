/**
 * NFT Marketplace E2E Integration Test
 * 
 * Tests complete user flows with real wallet interactions:
 * 1. Mint NFT → List → Buy → Withdraw proceeds
 * 2. Create auction → Place bids → End auction → Settle
 * 3. Fractionalize NFT → Distribute shares → Buyout → Claim proceeds
 * 
 * Run with: npx hardhat test test/E2E.test.js
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("E2E Integration Tests", function () {
    let marketplace, auctionEngine, fractionalVault, nft;
    let owner, seller, buyer, buyer2;

    const PLATFORM_FEE = 250; // 2.5%
    const ONE_HOUR = 3600;
    const ONE_DAY = 86400;

    beforeEach(async function () {
        [owner, seller, buyer, buyer2] = await ethers.getSigners();

        // Deploy NFT contract
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        nft = await ERC721NFT.deploy("TestNFT", "TNFT", 10000, owner.address, 500);
        await nft.waitForDeployment();

        // Deploy Marketplace
        const Marketplace = await ethers.getContractFactory("Marketplace");
        marketplace = await Marketplace.deploy(PLATFORM_FEE, owner.address);
        await marketplace.waitForDeployment();

        // Deploy AuctionEngine
        const AuctionEngine = await ethers.getContractFactory("AuctionEngine");
        auctionEngine = await AuctionEngine.deploy(PLATFORM_FEE, owner.address);
        await auctionEngine.waitForDeployment();

        // Deploy FractionalVault
        const FractionalVault = await ethers.getContractFactory("FractionalVault");
        fractionalVault = await FractionalVault.deploy();
        await fractionalVault.waitForDeployment();

        // Mint NFTs to seller
        for (let i = 0; i < 5; i++) {
            await nft.mint(seller.address, `ipfs://token/${i}`);
        }

        // Approvals
        await nft.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
        await nft.connect(seller).setApprovalForAll(await auctionEngine.getAddress(), true);
        await nft.connect(seller).setApprovalForAll(await fractionalVault.getAddress(), true);
    });

    describe("Flow 1: Mint → List → Buy → Withdraw", function () {
        it("Complete marketplace sale flow", async function () {
            const listingPrice = ethers.parseEther("1");

            // Step 1: Seller lists NFT
            console.log("📝 Seller listing NFT #0...");
            const listTx = await marketplace.connect(seller).listERC721(
                await nft.getAddress(),
                0,
                listingPrice
            );
            await listTx.wait();
            
            const listing = await marketplace.getListing(0);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.price).to.equal(listingPrice);
            console.log("✅ NFT listed at", ethers.formatEther(listingPrice), "ETH");

            // Step 2: Advance block (flash loan protection)
            await ethers.provider.send("evm_mine", []);

            // Step 3: Buyer purchases NFT
            console.log("💰 Buyer purchasing NFT...");
            const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
            const buyTx = await marketplace.connect(buyer).buy(0, { value: listingPrice });
            const buyReceipt = await buyTx.wait();
            
            // Verify ownership transferred
            expect(await nft.ownerOf(0)).to.equal(buyer.address);
            console.log("✅ NFT transferred to buyer");

            // Step 4: Seller withdraws proceeds
            console.log("🏦 Seller withdrawing proceeds...");
            const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
            const pendingAmount = await marketplace.pendingWithdrawals(seller.address);
            
            const withdrawTx = await marketplace.connect(seller).withdrawFunds();
            await withdrawTx.wait();
            
            const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
            expect(sellerBalanceAfter).to.be.gt(sellerBalanceBefore);
            console.log("✅ Seller received", ethers.formatEther(pendingAmount), "ETH");

            // Final verification
            console.log("\n📊 Final State:");
            console.log("   NFT Owner:", await nft.ownerOf(0));
            console.log("   Listing Status:", (await marketplace.getListing(0)).status);
        });
    });

    describe("Flow 2: Auction → Bid → End → Settle", function () {
        it("Complete English auction flow", async function () {
            const startPrice = ethers.parseEther("0.5");
            const reservePrice = ethers.parseEther("1");
            const duration = ONE_DAY;

            // Step 1: Create auction
            console.log("🔨 Creating English auction...");
            const createTx = await auctionEngine.connect(seller).createEnglishAuction(
                await nft.getAddress(),
                1, // tokenId
                startPrice,
                reservePrice,
                duration
            );
            await createTx.wait();
            console.log("✅ Auction created with start price", ethers.formatEther(startPrice), "ETH");

            // Step 2: Advance block (flash loan protection)
            await ethers.provider.send("evm_mine", []);

            // Step 3: First bid
            const bid1 = ethers.parseEther("0.6");
            console.log("💵 Buyer1 bidding", ethers.formatEther(bid1), "ETH...");
            await auctionEngine.connect(buyer).placeBid(0, { value: bid1 });
            console.log("✅ Bid placed");

            // Step 4: Second bid (outbids first)
            const bid2 = ethers.parseEther("1.2");
            console.log("💵 Buyer2 bidding", ethers.formatEther(bid2), "ETH...");
            await auctionEngine.connect(buyer2).placeBid(0, { value: bid2 });
            console.log("✅ Bid placed, buyer1 outbid");

            // Step 5: Fast forward past auction end
            await time.increase(duration + 1);

            // Step 6: End auction
            console.log("⏱️ Ending auction...");
            const endTx = await auctionEngine.endAuction(0);
            await endTx.wait();

            // Verify winner
            const auction = await auctionEngine.getAuction(0);
            expect(auction.highestBidder).to.equal(buyer2.address);
            expect(await nft.ownerOf(1)).to.equal(buyer2.address);
            console.log("✅ Auction ended, winner:", buyer2.address);

            // Step 7: Outbid buyer withdraws refund
            console.log("🏦 Buyer1 withdrawing refund...");
            const pendingRefund = await auctionEngine.pendingReturns(buyer.address);
            expect(pendingRefund).to.equal(bid1);
            
            await auctionEngine.connect(buyer).withdrawPendingReturns();
            console.log("✅ Refund of", ethers.formatEther(pendingRefund), "ETH withdrawn");

            console.log("\n📊 Final State:");
            console.log("   NFT Owner:", await nft.ownerOf(1));
            console.log("   Winning Bid:", ethers.formatEther(auction.highestBid), "ETH");
        });
    });

    describe("Flow 3: Fractionalize → Distribute → Buyout → Claim", function () {
        it("Complete fractionalization flow", async function () {
            const totalShares = 1000000n; // 1 million shares
            const reservePrice = ethers.parseEther("10");

            // Step 1: Fractionalize NFT
            console.log("🔀 Fractionalizing NFT #2...");
            const fracTx = await fractionalVault.connect(seller).fractionalize(
                await nft.getAddress(),
                2,
                totalShares,
                reservePrice,
                "Fractional NFT",
                "fNFT"
            );
            await fracTx.wait();
            
            const vault = await fractionalVault.getVault(0);
            console.log("✅ NFT fractionalized into", totalShares.toString(), "shares");

            // Step 2: Distribute shares
            const ShareToken = await ethers.getContractFactory("ShareToken");
            const shareToken = ShareToken.attach(vault.shareToken);
            
            console.log("📤 Distributing shares...");
            // Seller keeps 50%, gives 30% to buyer, 20% to buyer2
            const buyerShares = totalShares * 30n / 100n;
            const buyer2Shares = totalShares * 20n / 100n;
            
            await shareToken.connect(seller).transfer(buyer.address, buyerShares);
            await shareToken.connect(seller).transfer(buyer2.address, buyer2Shares);
            
            console.log("   Seller:", (await shareToken.balanceOf(seller.address)).toString(), "shares (50%)");
            console.log("   Buyer:", (await shareToken.balanceOf(buyer.address)).toString(), "shares (30%)");
            console.log("   Buyer2:", (await shareToken.balanceOf(buyer2.address)).toString(), "shares (20%)");

            // Step 3: Approve vault for burning (required for claims)
            await shareToken.connect(seller).approveVaultBurn(true);
            await shareToken.connect(buyer).approveVaultBurn(true);
            await shareToken.connect(buyer2).approveVaultBurn(true);

            // Step 4: Buyout by external party (owner in this case)
            const buyoutPrice = ethers.parseEther("15"); // Above reserve
            console.log("\n💎 External buyer initiating buyout at", ethers.formatEther(buyoutPrice), "ETH...");
            await fractionalVault.connect(owner).buyout(0, { value: buyoutPrice });
            console.log("✅ Buyout successful, NFT transferred to buyer");

            // Step 5: Shareholders claim proceeds
            console.log("\n🏦 Shareholders claiming proceeds...");
            
            const sellerClaimable = await fractionalVault.getClaimableAmount(0, seller.address);
            const buyerClaimable = await fractionalVault.getClaimableAmount(0, buyer.address);
            const buyer2Claimable = await fractionalVault.getClaimableAmount(0, buyer2.address);
            
            console.log("   Seller claimable:", ethers.formatEther(sellerClaimable), "ETH");
            console.log("   Buyer claimable:", ethers.formatEther(buyerClaimable), "ETH");
            console.log("   Buyer2 claimable:", ethers.formatEther(buyer2Claimable), "ETH");

            // Claim proceeds
            await fractionalVault.connect(seller).claimProceeds(0);
            await fractionalVault.connect(buyer).claimProceeds(0);
            await fractionalVault.connect(buyer2).claimProceeds(0);
            
            console.log("✅ All proceeds claimed");

            // Verify total distributed equals buyout price (minus dust)
            const totalClaimed = sellerClaimable + buyerClaimable + buyer2Claimable;
            expect(totalClaimed).to.be.closeTo(buyoutPrice, ethers.parseEther("0.001"));

            console.log("\n📊 Final State:");
            console.log("   NFT Owner:", await nft.ownerOf(2));
            console.log("   Vault State:", (await fractionalVault.getVault(0)).state);
            console.log("   Total Distributed:", ethers.formatEther(totalClaimed), "ETH");
        });
    });

    describe("Gas Benchmarks", function () {
        it("Measure gas for critical operations", async function () {
            console.log("\n⛽ Gas Benchmarks:");

            // List NFT
            const listTx = await marketplace.connect(seller).listERC721(
                await nft.getAddress(), 3, ethers.parseEther("1")
            );
            const listReceipt = await listTx.wait();
            console.log("   List ERC721:", listReceipt.gasUsed.toString(), "gas");

            // Advance block
            await ethers.provider.send("evm_mine", []);

            // Buy NFT
            const buyTx = await marketplace.connect(buyer).buy(0, { value: ethers.parseEther("1") });
            const buyReceipt = await buyTx.wait();
            console.log("   Buy NFT:", buyReceipt.gasUsed.toString(), "gas");

            // Withdraw
            const withdrawTx = await marketplace.connect(seller).withdrawFunds();
            const withdrawReceipt = await withdrawTx.wait();
            console.log("   Withdraw Funds:", withdrawReceipt.gasUsed.toString(), "gas");
        });
    });
});
