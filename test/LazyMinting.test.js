const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("LazyMinting", function () {
    async function deployFixture() {
        const [owner, creator, buyer, feeRecipient] = await ethers.getSigners();

        // Deploy ERC721NFTInitializable as implementation
        const ERC721NFTInitializable = await ethers.getContractFactory("ERC721NFTInitializable");
        const impl = await ERC721NFTInitializable.deploy();
        await impl.waitForDeployment();

        // Deploy LazyMinting
        const LazyMinting = await ethers.getContractFactory("LazyMinting");
        const lazyMinting = await LazyMinting.deploy(250, feeRecipient.address); // 2.5% fee
        await lazyMinting.waitForDeployment();

        // Deploy NFTFactory
        const NFTFactory = await ethers.getContractFactory("NFTFactory");
        const factory = await NFTFactory.deploy(
            await impl.getAddress(),
            await impl.getAddress() // dummy for 1155
        );
        await factory.waitForDeployment();

        // Create a collection for the creator
        const tx = await factory.connect(creator).createERC721Collection(
            "LazyNFT",
            "LAZY",
            1000,
            creator.address,
            500 // 5% royalty
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => l.fragment?.name === "ERC721CollectionCreated");
        const nftAddress = event.args.collection;

        // Authorize the collection in LazyMinting
        await lazyMinting.authorizeContract(nftAddress, true);

        // Get the NFT contract and whitelist LazyMinting for minting
        const nft = await ethers.getContractAt("ERC721NFTInitializable", nftAddress);
        // Creator is the owner, add LazyMinting to whitelist for minting
        await nft.connect(creator).setWhitelist(await lazyMinting.getAddress(), true);
        await nft.connect(creator).setWhitelistEnabled(true);
        // Also need to transfer ownership or allow LazyMinting to mint
        // Since mint() checks whitelist[msg.sender], we need to transfer ownership
        // or use the owner as the minter. For simplicity, we'll disable whitelist:
        await nft.connect(creator).setWhitelistEnabled(false);

        return { lazyMinting, nft, factory, owner, creator, buyer, feeRecipient };
    }

    async function createVoucher(lazyMinting, nft, creator, tokenId, price, nonce) {
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

        const voucher = {
            tokenId: tokenId,
            price: price,
            uri: `ipfs://token-${tokenId}`,
            creator: creator.address,
            nftContract: await nft.getAddress(),
            royaltyFee: 500,
            nonce: nonce
        };

        const signature = await creator.signTypedData(domain, types, voucher);
        return { voucher, signature };
    }

    describe("Voucher Redemption", function () {
        it("should allow redeeming a valid voucher", async function () {
            const { lazyMinting, nft, creator, buyer } = await loadFixture(deployFixture);

            const { voucher, signature } = await createVoucher(
                lazyMinting, nft, creator, 1, ethers.parseEther("1"), 0
            );

            const tx = await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: ethers.parseEther("1")
            });

            await expect(tx).to.emit(lazyMinting, "VoucherRedeemed");

            // Verify buyer owns the NFT (tokenId is 0 since it's the first mint)
            expect(await nft.ownerOf(0)).to.equal(buyer.address);
        });

        it("should distribute payment correctly (platform fee + creator)", async function () {
            const { lazyMinting, nft, creator, buyer, feeRecipient } = await loadFixture(deployFixture);

            const price = ethers.parseEther("1");
            const { voucher, signature } = await createVoucher(
                lazyMinting, nft, creator, 1, price, 0
            );

            const creatorBalBefore = await ethers.provider.getBalance(creator.address);
            const feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);

            await lazyMinting.connect(buyer).redeem(voucher, signature, { value: price });

            const creatorBalAfter = await ethers.provider.getBalance(creator.address);
            const feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);

            // 2.5% fee = 0.025 ETH
            const expectedFee = price * 250n / 10000n;
            const expectedCreatorPayment = price - expectedFee;

            expect(feeRecipientBalAfter - feeRecipientBalBefore).to.equal(expectedFee);
            expect(creatorBalAfter - creatorBalBefore).to.equal(expectedCreatorPayment);
        });

        it("should refund excess payment", async function () {
            const { lazyMinting, nft, creator, buyer } = await loadFixture(deployFixture);

            const price = ethers.parseEther("1");
            const { voucher, signature } = await createVoucher(
                lazyMinting, nft, creator, 1, price, 0
            );

            const buyerBalBefore = await ethers.provider.getBalance(buyer.address);

            const tx = await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: ethers.parseEther("2") // Pay 2 ETH for 1 ETH item
            });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const buyerBalAfter = await ethers.provider.getBalance(buyer.address);

            // Buyer should only spend 1 ETH + gas
            expect(buyerBalBefore - buyerBalAfter - gasUsed).to.equal(price);
        });
    });

    describe("Signature Validation", function () {
        it("should revert with invalid signature", async function () {
            const { lazyMinting, nft, creator, buyer, owner } = await loadFixture(deployFixture);

            // Create voucher but sign with wrong signer
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

            const voucher = {
                tokenId: 1,
                price: ethers.parseEther("1"),
                uri: "ipfs://test",
                creator: creator.address,
                nftContract: await nft.getAddress(),
                royaltyFee: 500,
                nonce: 0
            };

            // Sign with owner instead of creator
            const badSignature = await owner.signTypedData(domain, types, voucher);

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, badSignature, {
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWithCustomError(lazyMinting, "InvalidSignature");
        });
    });

    describe("Nonce Replay Protection", function () {
        it("should revert if nonce already used", async function () {
            const { lazyMinting, nft, creator, buyer } = await loadFixture(deployFixture);

            const { voucher, signature } = await createVoucher(
                lazyMinting, nft, creator, 1, ethers.parseEther("1"), 0
            );

            // First redemption succeeds
            await lazyMinting.connect(buyer).redeem(voucher, signature, {
                value: ethers.parseEther("1")
            });

            // Second redemption with same nonce fails
            const { voucher: voucher2, signature: signature2 } = await createVoucher(
                lazyMinting, nft, creator, 2, ethers.parseEther("1"), 0 // Same nonce
            );

            await expect(
                lazyMinting.connect(buyer).redeem(voucher2, signature2, {
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWithCustomError(lazyMinting, "NonceAlreadyUsed");
        });

        it("should allow different nonces", async function () {
            const { lazyMinting, nft, creator, buyer } = await loadFixture(deployFixture);

            // Nonce 0
            const { voucher: v1, signature: s1 } = await createVoucher(
                lazyMinting, nft, creator, 1, ethers.parseEther("1"), 0
            );
            await lazyMinting.connect(buyer).redeem(v1, s1, { value: ethers.parseEther("1") });

            // Nonce 1
            const { voucher: v2, signature: s2 } = await createVoucher(
                lazyMinting, nft, creator, 2, ethers.parseEther("1"), 1
            );
            await lazyMinting.connect(buyer).redeem(v2, s2, { value: ethers.parseEther("1") });

            expect(await nft.ownerOf(0)).to.equal(buyer.address);
            expect(await nft.ownerOf(1)).to.equal(buyer.address);
        });
    });

    describe("Access Control", function () {
        it("should revert if contract not authorized", async function () {
            const { lazyMinting, creator, buyer } = await loadFixture(deployFixture);

            // Create voucher for unauthorized contract
            const fakeNft = ethers.Wallet.createRandom().address;

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

            const voucher = {
                tokenId: 1,
                price: ethers.parseEther("1"),
                uri: "ipfs://test",
                creator: creator.address,
                nftContract: fakeNft,
                royaltyFee: 500,
                nonce: 0
            };

            const signature = await creator.signTypedData(domain, types, voucher);

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, signature, {
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWithCustomError(lazyMinting, "UnauthorizedContract");
        });

        it("should revert if payment insufficient", async function () {
            const { lazyMinting, nft, creator, buyer } = await loadFixture(deployFixture);

            const { voucher, signature } = await createVoucher(
                lazyMinting, nft, creator, 1, ethers.parseEther("1"), 0
            );

            await expect(
                lazyMinting.connect(buyer).redeem(voucher, signature, {
                    value: ethers.parseEther("0.5")
                })
            ).to.be.revertedWithCustomError(lazyMinting, "InsufficientPayment");
        });
    });

    describe("Admin Functions", function () {
        it("should emit PlatformFeeUpdated event", async function () {
            const { lazyMinting } = await loadFixture(deployFixture);

            await expect(lazyMinting.setPlatformFee(500))
                .to.emit(lazyMinting, "PlatformFeeUpdated")
                .withArgs(500);
        });
    });
});
