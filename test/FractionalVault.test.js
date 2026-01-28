const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("FractionalVault", function () {
    async function deployFixture() {
        const [owner, curator, buyer, shareholder1, shareholder2] = await ethers.getSigners();

        // Deploy mock ERC721
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        const nft = await ERC721NFT.deploy(
            "TestNFT",
            "TNFT",
            1000,
            owner.address,
            500 // 5% royalty
        );
        await nft.waitForDeployment();

        // Mint an NFT to curator
        await nft.mint(curator.address, "ipfs://test-uri");

        // Deploy FractionalVault
        const FractionalVault = await ethers.getContractFactory("FractionalVault");
        const vault = await FractionalVault.deploy();
        await vault.waitForDeployment();

        return { vault, nft, owner, curator, buyer, shareholder1, shareholder2 };
    }

    describe("Fractionalize", function () {
        it("should fractionalize an NFT into shares", async function () {
            const { vault, nft, curator } = await loadFixture(deployFixture);

            // Approve and fractionalize
            await nft.connect(curator).approve(await vault.getAddress(), 0);

            const tx = await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0, // tokenId
                1000000, // totalShares (1M)
                ethers.parseEther("10"), // reservePrice
                "Fractional TestNFT",
                "fTNFT"
            );

            await expect(tx).to.emit(vault, "VaultCreated");

            // Verify vault state
            const vaultData = await vault.getVault(0);
            expect(vaultData.curator).to.equal(curator.address);
            expect(vaultData.totalShares).to.equal(1000000);
            expect(vaultData.reservePrice).to.equal(ethers.parseEther("10"));
            expect(vaultData.state).to.equal(0); // Active
        });

        it("should revert if shares is zero", async function () {
            const { vault, nft, curator } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);

            await expect(
                vault.connect(curator).fractionalize(
                    await nft.getAddress(),
                    0,
                    0, // zero shares
                    ethers.parseEther("10"),
                    "Fractional TestNFT",
                    "fTNFT"
                )
            ).to.be.revertedWithCustomError(vault, "InvalidShares");
        });

        it("should transfer share tokens to curator", async function () {
            const { vault, nft, curator } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);

            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Fractional TestNFT",
                "fTNFT"
            );

            const vaultData = await vault.getVault(0);
            const ShareToken = await ethers.getContractFactory("ShareToken");
            const shareToken = ShareToken.attach(vaultData.shareToken);

            expect(await shareToken.balanceOf(curator.address)).to.equal(1000000);
        });
    });

    describe("Buyout", function () {
        async function fractionalizedFixture() {
            const base = await loadFixture(deployFixture);
            const { vault, nft, curator } = base;

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Fractional TestNFT",
                "fTNFT"
            );

            return base;
        }

        it("should allow buyout at reserve price", async function () {
            const { vault, nft, buyer } = await loadFixture(fractionalizedFixture);

            const tx = await vault.connect(buyer).buyout(0, {
                value: ethers.parseEther("10")
            });

            await expect(tx).to.emit(vault, "BuyoutInitiated")
                .withArgs(0, buyer.address, ethers.parseEther("10"));

            // Verify buyer received NFT
            expect(await nft.ownerOf(0)).to.equal(buyer.address);

            // Verify vault state changed
            const vaultData = await vault.getVault(0);
            expect(vaultData.state).to.equal(1); // Bought
            expect(vaultData.buyoutPrice).to.equal(ethers.parseEther("10"));
        });

        it("should revert if payment below reserve price", async function () {
            const { vault, buyer } = await loadFixture(fractionalizedFixture);

            await expect(
                vault.connect(buyer).buyout(0, {
                    value: ethers.parseEther("9")
                })
            ).to.be.revertedWithCustomError(vault, "InsufficientPayment");
        });

        it("should allow buyout above reserve price", async function () {
            const { vault, nft, buyer } = await loadFixture(fractionalizedFixture);

            await vault.connect(buyer).buyout(0, {
                value: ethers.parseEther("15")
            });

            const vaultData = await vault.getVault(0);
            expect(vaultData.buyoutPrice).to.equal(ethers.parseEther("15"));
        });
    });

    describe("ClaimProceeds - CRITICAL BUG FIX", function () {
        async function boughtOutFixture() {
            const base = await loadFixture(deployFixture);
            const { vault, nft, curator, buyer, shareholder1, shareholder2 } = base;

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000, // 1M shares
                ethers.parseEther("10"),
                "Fractional TestNFT",
                "fTNFT"
            );

            // Transfer shares to shareholders
            const vaultData = await vault.getVault(0);
            const ShareToken = await ethers.getContractFactory("ShareToken");
            const shareToken = ShareToken.attach(vaultData.shareToken);

            // Curator keeps 500k, transfers 300k to shareholder1, 200k to shareholder2
            await shareToken.connect(curator).transfer(shareholder1.address, 300000);
            await shareToken.connect(curator).transfer(shareholder2.address, 200000);

            // Buyout at 10 ETH
            await vault.connect(buyer).buyout(0, { value: ethers.parseEther("10") });

            return { ...base, shareToken };
        }

        it("should allow shareholders to claim pro-rata proceeds", async function () {
            const { vault, curator, shareholder1, shareholder2, shareToken } = await loadFixture(boughtOutFixture);

            // Calculate expected amounts (10 ETH total)
            // curator: 500k/1M = 50% = 5 ETH
            // shareholder1: 300k/1M = 30% = 3 ETH
            // shareholder2: 200k/1M = 20% = 2 ETH

            // IMPORTANT: Users must approve vault to burn their shares before claiming
            await shareToken.connect(curator).approveVaultBurn(true);
            await shareToken.connect(shareholder1).approveVaultBurn(true);
            await shareToken.connect(shareholder2).approveVaultBurn(true);

            const curatorBalBefore = await ethers.provider.getBalance(curator.address);
            const tx1 = await vault.connect(curator).claimProceeds(0);
            const receipt1 = await tx1.wait();
            const gas1 = receipt1.gasUsed * receipt1.gasPrice;
            const curatorBalAfter = await ethers.provider.getBalance(curator.address);

            // Curator should receive ~5 ETH (minus gas)
            expect(curatorBalAfter - curatorBalBefore + gas1).to.equal(ethers.parseEther("5"));

            await expect(tx1).to.emit(vault, "ProceedsClaimed")
                .withArgs(0, curator.address, 500000, ethers.parseEther("5"));

            // Shareholder1 claims
            const sh1BalBefore = await ethers.provider.getBalance(shareholder1.address);
            const tx2 = await vault.connect(shareholder1).claimProceeds(0);
            const receipt2 = await tx2.wait();
            const gas2 = receipt2.gasUsed * receipt2.gasPrice;
            const sh1BalAfter = await ethers.provider.getBalance(shareholder1.address);

            expect(sh1BalAfter - sh1BalBefore + gas2).to.equal(ethers.parseEther("3"));

            // Shareholder2 claims
            const sh2BalBefore = await ethers.provider.getBalance(shareholder2.address);
            const tx3 = await vault.connect(shareholder2).claimProceeds(0);
            const receipt3 = await tx3.wait();
            const gas3 = receipt3.gasUsed * receipt3.gasPrice;
            const sh2BalAfter = await ethers.provider.getBalance(shareholder2.address);

            expect(sh2BalAfter - sh2BalBefore + gas3).to.equal(ethers.parseEther("2"));

            // Vault should be empty
            expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0);
        });

        it("should burn share tokens after claiming", async function () {
            const { vault, curator, shareToken } = await loadFixture(boughtOutFixture);

            expect(await shareToken.balanceOf(curator.address)).to.equal(500000);

            // Approve vault to burn shares
            await shareToken.connect(curator).approveVaultBurn(true);
            await vault.connect(curator).claimProceeds(0);

            expect(await shareToken.balanceOf(curator.address)).to.equal(0);
        });

        it("should revert if not approved for vault burn", async function () {
            const { vault, curator, shareToken } = await loadFixture(boughtOutFixture);

            // Try to claim without approving - should fail
            await expect(
                vault.connect(curator).claimProceeds(0)
            ).to.be.revertedWithCustomError(shareToken, "NotApprovedForVaultBurn");
        });

        it("should revert if no shares to claim", async function () {
            const { vault, buyer } = await loadFixture(boughtOutFixture);

            await expect(
                vault.connect(buyer).claimProceeds(0) // buyer has no shares
            ).to.be.revertedWithCustomError(vault, "NothingToClaim");
        });

        it("should revert if vault not in Bought state", async function () {
            const { vault, curator, nft } = await loadFixture(deployFixture);

            // Create vault but don't buyout
            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Test",
                "TST"
            );

            await expect(
                vault.connect(curator).claimProceeds(0)
            ).to.be.revertedWithCustomError(vault, "VaultNotBought");
        });

        it("should return correct claimable amount via view function", async function () {
            const { vault, curator, shareholder1, shareholder2 } = await loadFixture(boughtOutFixture);

            expect(await vault.getClaimableAmount(0, curator.address)).to.equal(ethers.parseEther("5"));
            expect(await vault.getClaimableAmount(0, shareholder1.address)).to.equal(ethers.parseEther("3"));
            expect(await vault.getClaimableAmount(0, shareholder2.address)).to.equal(ethers.parseEther("2"));
        });
    });

    describe("Redeem", function () {
        it("should allow full share owner to redeem NFT", async function () {
            const { vault, nft, curator } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Test",
                "TST"
            );

            // Get share token and approve vault burn
            const vaultData = await vault.getVault(0);
            const ShareToken = await ethers.getContractFactory("ShareToken");
            const shareToken = ShareToken.attach(vaultData.shareToken);
            await shareToken.connect(curator).approveVaultBurn(true);

            // Curator has all shares, can redeem
            const tx = await vault.connect(curator).redeem(0);
            await expect(tx).to.emit(vault, "VaultRedeemed");

            // NFT returned to curator
            expect(await nft.ownerOf(0)).to.equal(curator.address);
        });

        it("should revert if not all shares owned", async function () {
            const { vault, nft, curator, shareholder1 } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Test",
                "TST"
            );

            // Transfer some shares away
            const vaultData = await vault.getVault(0);
            const ShareToken = await ethers.getContractFactory("ShareToken");
            const shareToken = ShareToken.attach(vaultData.shareToken);
            await shareToken.connect(curator).transfer(shareholder1.address, 1);

            await expect(
                vault.connect(curator).redeem(0)
            ).to.be.revertedWithCustomError(vault, "NotAllSharesOwned");
        });
    });

    describe("UpdateReservePrice", function () {
        it("should allow curator to update reserve price", async function () {
            const { vault, nft, curator } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Test",
                "TST"
            );

            await expect(vault.connect(curator).updateReservePrice(0, ethers.parseEther("20")))
                .to.emit(vault, "ReservePriceUpdated")
                .withArgs(0, ethers.parseEther("20"));

            const vaultData = await vault.getVault(0);
            expect(vaultData.reservePrice).to.equal(ethers.parseEther("20"));
        });

        it("should revert if not curator", async function () {
            const { vault, nft, curator, buyer } = await loadFixture(deployFixture);

            await nft.connect(curator).approve(await vault.getAddress(), 0);
            await vault.connect(curator).fractionalize(
                await nft.getAddress(),
                0,
                1000000,
                ethers.parseEther("10"),
                "Test",
                "TST"
            );

            await expect(
                vault.connect(buyer).updateReservePrice(0, ethers.parseEther("20"))
            ).to.be.revertedWithCustomError(vault, "NotCurator");
        });
    });
});
