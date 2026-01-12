const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LazyMinting", function () {
    let lazyMinting;
    let nft;
    let owner, creator, buyer;

    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;  // 5%

    beforeEach(async function () {
        [owner, creator, buyer] = await ethers.getSigners();

        // Deploy standalone ERC721NFT for testing
        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        nft = await ERC721NFT.deploy(
            "LazyNFT",
            "LNFT",
            10000,
            creator.address,
            ROYALTY_FEE
        );

        // Deploy LazyMinting
        const LazyMinting = await ethers.getContractFactory("LazyMinting");
        lazyMinting = await LazyMinting.deploy(PLATFORM_FEE, owner.address);

        // Authorize collection
        await lazyMinting.authorizeContract(await nft.getAddress(), true);

        // Give LazyMinting minting rights
        await nft.connect(owner).updateWhitelist([await lazyMinting.getAddress()], [true]);
    });

    describe("Deployment", function () {
        it("Should set correct platform fee", async function () {
            expect(await lazyMinting.platformFee()).to.equal(PLATFORM_FEE);
        });

        it("Should set correct fee recipient", async function () {
            expect(await lazyMinting.feeRecipient()).to.equal(owner.address);
        });
    });

    describe("Voucher Redemption", function () {
        async function createSignedVoucher(tokenId, price, nonce) {
            const voucher = {
                tokenId,
                price,
                uri: `ipfs://token/${tokenId}`,
                creator: creator.address,
                nftContract: await nft.getAddress(),
                royaltyFee: ROYALTY_FEE,
                nonce
            };

            const domain = {
                name: "LazyMinting",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await lazyMinting.getAddress()
            };

            const types = {
                NFTVoucher: [
                    { name: "tokenId", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "uri", type: "string" },
                    { name: "creator", type: "address" },
                    { name: "nftContract", type: "address" },
                    { name: "royaltyFee", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const signature = await creator.signTypedData(domain, types, voucher);
            return { voucher, signature };
        }

        it("Should redeem valid voucher", async function () {
            const { voucher, signature } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: voucher.price
            });

            expect(await nft.ownerOf(1)).to.equal(buyer.address);
        });

        it("Should reject invalid signature", async function () {
            const { voucher } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            const domain = {
                name: "LazyMinting",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await lazyMinting.getAddress()
            };

            const types = {
                NFTVoucher: [
                    { name: "tokenId", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "uri", type: "string" },
                    { name: "creator", type: "address" },
                    { name: "nftContract", type: "address" },
                    { name: "royaltyFee", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const wrongSignature = await buyer.signTypedData(domain, types, voucher);

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, wrongSignature, {
                    value: voucher.price
                })
            ).to.be.revertedWithCustomError(lazyMinting, "InvalidSignature");
        });

        it("Should prevent nonce reuse", async function () {
            const { voucher, signature } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: voucher.price
            });

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, signature, {
                    value: voucher.price
                })
            ).to.be.revertedWithCustomError(lazyMinting, "NonceAlreadyUsed");
        });

        it("Should reject insufficient payment", async function () {
            const { voucher, signature } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, signature, {
                    value: ethers.parseEther("0.5")
                })
            ).to.be.revertedWithCustomError(lazyMinting, "InsufficientPayment");
        });

        it("Should refund excess payment", async function () {
            const { voucher, signature } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            const balanceBefore = await ethers.provider.getBalance(buyer.address);

            const tx = await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: ethers.parseEther("2")
            });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balanceAfter = await ethers.provider.getBalance(buyer.address);
            const spent = balanceBefore - balanceAfter - gasUsed;

            expect(spent).to.be.closeTo(voucher.price, ethers.parseEther("0.001"));
        });
    });

    describe("Payment Distribution", function () {
        it("Should distribute fees correctly", async function () {
            const price = ethers.parseEther("1");
            const { voucher, signature } = await createSignedVoucher(1, price, 0);

            const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);
            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

            await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: price
            });

            const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

            const platformAmount = (price * BigInt(PLATFORM_FEE)) / 10000n;

            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(platformAmount);
            expect(creatorBalanceAfter).to.be.gt(creatorBalanceBefore);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to authorize contracts", async function () {
            const newContract = ethers.Wallet.createRandom().address;
            await lazyMinting.authorizeContract(newContract, true);
            expect(await lazyMinting.authorizedContracts(newContract)).to.be.true;
        });

        it("Should allow owner to set platform fee", async function () {
            await lazyMinting.setPlatformFee(500);
            expect(await lazyMinting.platformFee()).to.equal(500);
        });

        it("Should allow owner to pause", async function () {
            await lazyMinting.pause();

            const { voucher, signature } = await createSignedVoucher(1, ethers.parseEther("1"), 0);

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, signature, {
                    value: voucher.price
                })
            ).to.be.revertedWithCustomError(lazyMinting, "EnforcedPause");
        });
    });
});
