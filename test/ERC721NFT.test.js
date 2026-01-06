const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC721NFT", function () {
    let nft;
    let owner;
    let addr1;
    let addr2;
    let addrs;

    // Deploy fresh contract before each test
    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
        nft = await ERC721NFT.deploy(
            "TestNFT",           // name
            "TNFT",              // symbol
            100,                 // maxSupply
            owner.address,       // royalty receiver
            500                  // 5% royalty (500 basis points)
        );
    });

    describe("Deployment", function () {
        it("Should set the correct name and symbol", async function () {
            expect(await nft.name()).to.equal("TestNFT");
            expect(await nft.symbol()).to.equal("TNFT");
        });

        it("Should set the correct max supply", async function () {
            expect(await nft.maxSupply()).to.equal(100);
        });

        it("Should set the correct owner", async function () {
            expect(await nft.owner()).to.equal(owner.address);
        });

        it("Should start with zero total supply", async function () {
            expect(await nft.totalSupply()).to.equal(0);
        });
    });

    describe("Minting", function () {
        it("Should mint a single NFT", async function () {
            const tx = await nft.mint(addr1.address, "ipfs://test-uri");

            expect(await nft.totalSupply()).to.equal(1);
            expect(await nft.ownerOf(0)).to.equal(addr1.address);
            expect(await nft.tokenURI(0)).to.equal("ipfs://test-uri");

            // Check event emission
            await expect(tx)
                .to.emit(nft, "TokenMinted")
                .withArgs(addr1.address, 0, "ipfs://test-uri");
        });

        it("Should batch mint multiple NFTs", async function () {
            const quantity = 5;
            const tx = await nft.batchMint(addr1.address, quantity, "ipfs://base-uri/");

            expect(await nft.totalSupply()).to.equal(quantity);

            // Check all tokens were minted
            for (let i = 0; i < quantity; i++) {
                expect(await nft.ownerOf(i)).to.equal(addr1.address);
            }

            // Check event emission
            await expect(tx)
                .to.emit(nft, "BatchMinted")
                .withArgs(addr1.address, 0, quantity);
        });

        it("Should fail to mint beyond max supply", async function () {
            // Mint up to max supply
            await nft.batchMint(addr1.address, 100, "");

            // Try to mint one more
            await expect(
                nft.mint(addr1.address, "ipfs://overflow")
            ).to.be.revertedWithCustomError(nft, "MaxSupplyReached");
        });

        it("Should fail to mint to zero address", async function () {
            await expect(
                nft.mint(ethers.ZeroAddress, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "InvalidAddress");
        });

        it("Should fail to batch mint with zero quantity", async function () {
            await expect(
                nft.batchMint(addr1.address, 0, "")
            ).to.be.revertedWithCustomError(nft, "InvalidQuantity");
        });
    });

    describe("Whitelist", function () {
        beforeEach(async function () {
            // Enable whitelist
            await nft.setWhitelistEnabled(true);
        });

        it("Should allow whitelisted address to mint", async function () {
            // Whitelist addr1
            await nft.setWhitelist(addr1.address, true);

            // addr1 should be able to mint
            await nft.connect(addr1).mint(addr1.address, "ipfs://test");
            expect(await nft.totalSupply()).to.equal(1);
        });

        it("Should prevent non-whitelisted address from minting", async function () {
            // addr1 is not whitelisted
            await expect(
                nft.connect(addr1).mint(addr1.address, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "NotWhitelisted");
        });

        it("Should batch update whitelist", async function () {
            const addresses = [addr1.address, addr2.address];
            await nft.batchSetWhitelist(addresses, true);

            expect(await nft.whitelist(addr1.address)).to.be.true;
            expect(await nft.whitelist(addr2.address)).to.be.true;
        });

        it("Should allow minting when whitelist is disabled", async function () {
            // Disable whitelist
            await nft.setWhitelistEnabled(false);

            // Anyone should be able to mint
            await nft.connect(addr1).mint(addr1.address, "ipfs://test");
            expect(await nft.totalSupply()).to.equal(1);
        });
    });

    describe("Royalties (EIP-2981)", function () {
        it("Should return correct royalty info", async function () {
            const salePrice = ethers.parseEther("1"); // 1 ETH
            const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);

            expect(receiver).to.equal(owner.address);
            // 5% of 1 ETH = 0.05 ETH
            expect(royaltyAmount).to.equal(ethers.parseEther("0.05"));
        });

        it("Should allow owner to update royalty", async function () {
            await nft.setDefaultRoyalty(addr1.address, 1000); // 10%

            const salePrice = ethers.parseEther("1");
            const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);

            expect(receiver).to.equal(addr1.address);
            expect(royaltyAmount).to.equal(ethers.parseEther("0.1")); // 10%
        });
    });

    describe("Pausable", function () {
        it("Should pause and unpause transfers", async function () {
            // Mint a token
            await nft.mint(addr1.address, "ipfs://test");

            // Pause the contract
            await nft.pause();

            // Transfers should fail
            await expect(
                nft.connect(addr1).transferFrom(addr1.address, addr2.address, 0)
            ).to.be.revertedWithCustomError(nft, "EnforcedPause");

            // Unpause
            await nft.unpause();

            // Transfers should work
            await nft.connect(addr1).transferFrom(addr1.address, addr2.address, 0);
            expect(await nft.ownerOf(0)).to.equal(addr2.address);
        });

        it("Should prevent minting when paused", async function () {
            await nft.pause();

            await expect(
                nft.mint(addr1.address, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "EnforcedPause");
        });
    });

    describe("Burnable", function () {
        it("Should allow token owner to burn", async function () {
            await nft.mint(addr1.address, "ipfs://test");

            await nft.connect(addr1).burn(0);

            await expect(nft.ownerOf(0)).to.be.revertedWithCustomError(
                nft,
                "ERC721NonexistentToken"
            );
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to update max supply", async function () {
            await nft.setMaxSupply(200);
            expect(await nft.maxSupply()).to.equal(200);
        });

        it("Should prevent setting max supply below current supply", async function () {
            await nft.batchMint(addr1.address, 50, "");

            await expect(
                nft.setMaxSupply(40)
            ).to.be.revertedWith("Cannot set max supply below current supply");
        });

        it("Should allow owner to set base URI", async function () {
            await nft.setBaseURI("ipfs://new-base/");

            // Mint a token
            await nft.mint(addr1.address, "1.json");

            // Token URI should use base URI
            expect(await nft.tokenURI(0)).to.equal("ipfs://new-base/1.json");
        });

        it("Should prevent non-owner from admin functions", async function () {
            await expect(
                nft.connect(addr1).setMaxSupply(200)
            ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");

            await expect(
                nft.connect(addr1).pause()
            ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
        });
    });

    describe("Gas Optimization", function () {
        it("Should use less gas for batch minting vs individual mints", async function () {
            const quantity = 10;

            // Individual mints
            const individualGas = [];
            for (let i = 0; i < quantity; i++) {
                const tx = await nft.mint(addr1.address, `ipfs://token-${i}`);
                const receipt = await tx.wait();
                individualGas.push(receipt.gasUsed);
            }
            const totalIndividualGas = individualGas.reduce((a, b) => a + b, 0n);

            // Deploy new contract for batch test
            const ERC721NFT = await ethers.getContractFactory("ERC721NFT");
            const nft2 = await ERC721NFT.deploy("Test", "TST", 100, owner.address, 500);

            // Batch mint
            const batchTx = await nft2.batchMint(addr1.address, quantity, "ipfs://base/");
            const batchReceipt = await batchTx.wait();

            console.log(`Individual mints total gas: ${totalIndividualGas}`);
            console.log(`Batch mint gas: ${batchReceipt.gasUsed}`);

            // Batch should use less gas
            expect(batchReceipt.gasUsed).to.be.lessThan(totalIndividualGas);
        });
    });
});
