const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC1155NFT", function () {
    let nft;
    let owner;
    let addr1;
    let addr2;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        const ERC1155NFT = await ethers.getContractFactory("ERC1155NFT");
        nft = await ERC1155NFT.deploy(
            "TestNFT",
            "TNFT",
            "ipfs://base/",
            owner.address,
            500
        );
    });

    describe("Deployment", function () {
        it("Should set the correct name and symbol", async function () {
            expect(await nft.name()).to.equal("TestNFT");
            expect(await nft.symbol()).to.equal("TNFT");
        });

        it("Should set the correct owner", async function () {
            expect(await nft.owner()).to.equal(owner.address);
        });

        it("Should start with zero token types", async function () {
            expect(await nft.totalTokenTypes()).to.equal(0);
        });
    });

    describe("Minting", function () {
        it("Should mint a new token type", async function () {
            const tx = await nft.mint(addr1.address, 100, "ipfs://token-0");

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(100);
            expect(await nft["totalSupply(uint256)"](0)).to.equal(100);
            expect(await nft.uri(0)).to.equal("ipfs://token-0");

            await expect(tx)
                .to.emit(nft, "TokenMinted")
                .withArgs(addr1.address, 0, 100, "ipfs://token-0");
        });

        it("Should mint additional supply of existing token", async function () {
            await nft.mint(addr1.address, 100, "ipfs://token-0");
            await nft.mintExisting(addr2.address, 0, 50);

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(100);
            expect(await nft.balanceOf(addr2.address, 0)).to.equal(50);
            expect(await nft["totalSupply(uint256)"](0)).to.equal(150);
        });

        it("Should batch mint multiple token types", async function () {
            const amounts = [100, 50, 25];
            const uris = ["ipfs://token-0", "ipfs://token-1", "ipfs://token-2"];

            const tx = await nft.mintBatch(addr1.address, amounts, uris);

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(100);
            expect(await nft.balanceOf(addr1.address, 1)).to.equal(50);
            expect(await nft.balanceOf(addr1.address, 2)).to.equal(25);
            expect(await nft.totalTokenTypes()).to.equal(3);
        });

        it("Should fail to mint to zero address", async function () {
            await expect(
                nft.mint(ethers.ZeroAddress, 100, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "InvalidAddress");
        });

        it("Should fail to mint zero amount", async function () {
            await expect(
                nft.mint(addr1.address, 0, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "InvalidQuantity");
        });

        it("Should fail to mint non-existent token", async function () {
            await expect(
                nft.mintExisting(addr1.address, 999, 100)
            ).to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
        });
    });

    describe("Max Supply", function () {
        it("Should respect max supply per token", async function () {
            await nft.mint(addr1.address, 100, "ipfs://token-0");
            await nft.setMaxSupply(0, 150);

            await nft.mintExisting(addr1.address, 0, 50);
            expect(await nft["totalSupply(uint256)"](0)).to.equal(150);

            await expect(
                nft.mintExisting(addr1.address, 0, 1)
            ).to.be.revertedWithCustomError(nft, "MaxSupplyReached");
        });

        it("Should not allow max supply below current supply", async function () {
            await nft.mint(addr1.address, 100, "ipfs://token-0");

            await expect(
                nft.setMaxSupply(0, 50)
            ).to.be.revertedWith("Max supply below current supply");
        });
    });

    describe("Whitelist", function () {
        beforeEach(async function () {
            await nft.setWhitelistEnabled(true);
        });

        it("Should allow whitelisted address to mint", async function () {
            await nft.setWhitelist(addr1.address, true);

            await nft.connect(addr1).mint(addr1.address, 100, "ipfs://test");
            expect(await nft.balanceOf(addr1.address, 0)).to.equal(100);
        });

        it("Should prevent non-whitelisted address from minting", async function () {
            await expect(
                nft.connect(addr1).mint(addr1.address, 100, "ipfs://test")
            ).to.be.revertedWithCustomError(nft, "NotWhitelisted");
        });

        it("Should batch update whitelist", async function () {
            await nft.batchSetWhitelist([addr1.address, addr2.address], true);

            expect(await nft.whitelist(addr1.address)).to.be.true;
            expect(await nft.whitelist(addr2.address)).to.be.true;
        });
    });

    describe("Royalties (EIP-2981)", function () {
        it("Should return correct default royalty info", async function () {
            const salePrice = ethers.parseEther("1");
            const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);

            expect(receiver).to.equal(owner.address);
            expect(royaltyAmount).to.equal(ethers.parseEther("0.05"));
        });

        it("Should allow per-token royalty", async function () {
            await nft.mint(addr1.address, 100, "ipfs://token-0");
            await nft.setTokenRoyalty(0, addr1.address, 1000);

            const salePrice = ethers.parseEther("1");
            const [receiver, royaltyAmount] = await nft.royaltyInfo(0, salePrice);

            expect(receiver).to.equal(addr1.address);
            expect(royaltyAmount).to.equal(ethers.parseEther("0.1"));
        });
    });

    describe("Pausable", function () {
        it("Should pause and unpause", async function () {
            await nft.mint(addr1.address, 100, "ipfs://test");

            await nft.pause();

            await expect(
                nft.connect(addr1).safeTransferFrom(addr1.address, addr2.address, 0, 50, "0x")
            ).to.be.revertedWithCustomError(nft, "EnforcedPause");

            await nft.unpause();

            await nft.connect(addr1).safeTransferFrom(addr1.address, addr2.address, 0, 50, "0x");
            expect(await nft.balanceOf(addr2.address, 0)).to.equal(50);
        });
    });

    describe("Burnable", function () {
        it("Should allow token owner to burn", async function () {
            await nft.mint(addr1.address, 100, "ipfs://test");

            await nft.connect(addr1).burn(addr1.address, 0, 30);

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(70);
            expect(await nft["totalSupply(uint256)"](0)).to.equal(70);
        });

        it("Should allow batch burn", async function () {
            await nft.mintBatch(addr1.address, [100, 50], ["uri1", "uri2"]);

            await nft.connect(addr1).burnBatch(addr1.address, [0, 1], [30, 20]);

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(70);
            expect(await nft.balanceOf(addr1.address, 1)).to.equal(30);
        });
    });

    describe("URI Management", function () {
        it("Should return token-specific URI", async function () {
            await nft.mint(addr1.address, 100, "ipfs://custom-uri");
            expect(await nft.uri(0)).to.equal("ipfs://custom-uri");
        });

        it("Should allow owner to update token URI", async function () {
            await nft.mint(addr1.address, 100, "ipfs://old-uri");

            await nft.setTokenURI(0, "ipfs://new-uri");

            expect(await nft.uri(0)).to.equal("ipfs://new-uri");
        });

        it("Should allow owner to update base URI", async function () {
            await nft.setBaseURI("ipfs://new-base/");
            await nft.mint(addr1.address, 100, "");

            expect(await nft.uri(0)).to.equal("ipfs://new-base/");
        });
    });

    describe("Transfers", function () {
        it("Should transfer tokens between addresses", async function () {
            await nft.mint(addr1.address, 100, "ipfs://test");

            await nft.connect(addr1).safeTransferFrom(
                addr1.address, addr2.address, 0, 40, "0x"
            );

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(60);
            expect(await nft.balanceOf(addr2.address, 0)).to.equal(40);
        });

        it("Should batch transfer", async function () {
            await nft.mintBatch(addr1.address, [100, 50], ["uri1", "uri2"]);

            await nft.connect(addr1).safeBatchTransferFrom(
                addr1.address, addr2.address, [0, 1], [30, 20], "0x"
            );

            expect(await nft.balanceOf(addr1.address, 0)).to.equal(70);
            expect(await nft.balanceOf(addr2.address, 0)).to.equal(30);
            expect(await nft.balanceOf(addr1.address, 1)).to.equal(30);
            expect(await nft.balanceOf(addr2.address, 1)).to.equal(20);
        });
    });
});
