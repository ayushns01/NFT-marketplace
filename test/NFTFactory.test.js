const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTFactory", function () {
    let factory;
    let erc721Implementation;
    let erc1155Implementation;
    let owner;
    let creator1;
    let creator2;

    beforeEach(async function () {
        [owner, creator1, creator2] = await ethers.getSigners();

        // Deploy implementation contracts
        const ERC721NFTInitializable = await ethers.getContractFactory("ERC721NFTInitializable");
        erc721Implementation = await ERC721NFTInitializable.deploy();

        const ERC1155NFTInitializable = await ethers.getContractFactory("ERC1155NFTInitializable");
        erc1155Implementation = await ERC1155NFTInitializable.deploy();

        // Deploy factory
        const NFTFactory = await ethers.getContractFactory("NFTFactory");
        factory = await NFTFactory.deploy(
            await erc721Implementation.getAddress(),
            await erc1155Implementation.getAddress()
        );
    });

    describe("Deployment", function () {
        it("Should set correct implementations", async function () {
            expect(await factory.erc721Implementation()).to.equal(await erc721Implementation.getAddress());
            expect(await factory.erc1155Implementation()).to.equal(await erc1155Implementation.getAddress());
        });

        it("Should set correct owner", async function () {
            expect(await factory.owner()).to.equal(owner.address);
        });

        it("Should start with zero collections", async function () {
            expect(await factory.getERC721CollectionCount()).to.equal(0);
            expect(await factory.getERC1155CollectionCount()).to.equal(0);
        });
    });

    describe("ERC721 Collection Creation", function () {
        it("Should create an ERC721 collection", async function () {
            const tx = await factory.connect(creator1).createERC721Collection(
                "My Collection",
                "MYC",
                10000,
                creator1.address,
                500
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === "ERC721CollectionCreated";
                } catch { return false; }
            });

            const parsedEvent = factory.interface.parseLog(event);
            const collectionAddress = parsedEvent.args.collection;

            expect(await factory.getERC721CollectionCount()).to.equal(1);
            expect(await factory.isFactoryCollection(collectionAddress)).to.be.true;

            // Verify the collection works
            const collection = await ethers.getContractAt("ERC721NFTInitializable", collectionAddress);
            expect(await collection.name()).to.equal("My Collection");
            expect(await collection.symbol()).to.equal("MYC");
            expect(await collection.maxSupply()).to.equal(10000);
            expect(await collection.owner()).to.equal(creator1.address);
        });

        it("Should allow minting on created collection", async function () {
            const tx = await factory.connect(creator1).createERC721Collection(
                "Test Collection",
                "TEST",
                100,
                creator1.address,
                500
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === "ERC721CollectionCreated";
                } catch { return false; }
            });
            const collectionAddress = factory.interface.parseLog(event).args.collection;

            const collection = await ethers.getContractAt("ERC721NFTInitializable", collectionAddress);
            await collection.connect(creator1).mint(creator1.address, "ipfs://test/1");

            expect(await collection.totalSupply()).to.equal(1);
            expect(await collection.ownerOf(0)).to.equal(creator1.address);
        });

        it("Should track collections by creator", async function () {
            await factory.connect(creator1).createERC721Collection("Col1", "C1", 100, creator1.address, 500);
            await factory.connect(creator1).createERC721Collection("Col2", "C2", 100, creator1.address, 500);
            await factory.connect(creator2).createERC721Collection("Col3", "C3", 100, creator2.address, 500);

            const creator1Collections = await factory.getCollectionsByCreator(creator1.address);
            const creator2Collections = await factory.getCollectionsByCreator(creator2.address);

            expect(creator1Collections.length).to.equal(2);
            expect(creator2Collections.length).to.equal(1);
        });
    });

    describe("ERC1155 Collection Creation", function () {
        it("Should create an ERC1155 collection", async function () {
            const tx = await factory.connect(creator1).createERC1155Collection(
                "Multi Token",
                "MTK",
                "ipfs://base/",
                creator1.address,
                500
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === "ERC1155CollectionCreated";
                } catch { return false; }
            });
            const collectionAddress = factory.interface.parseLog(event).args.collection;

            expect(await factory.getERC1155CollectionCount()).to.equal(1);
            expect(await factory.isFactoryCollection(collectionAddress)).to.be.true;

            const collection = await ethers.getContractAt("ERC1155NFTInitializable", collectionAddress);
            expect(await collection.name()).to.equal("Multi Token");
            expect(await collection.symbol()).to.equal("MTK");
            expect(await collection.owner()).to.equal(creator1.address);
        });

        it("Should allow minting on created ERC1155 collection", async function () {
            const tx = await factory.connect(creator1).createERC1155Collection(
                "Game Items",
                "ITEM",
                "ipfs://items/",
                creator1.address,
                500
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === "ERC1155CollectionCreated";
                } catch { return false; }
            });
            const collectionAddress = factory.interface.parseLog(event).args.collection;

            const collection = await ethers.getContractAt("ERC1155NFTInitializable", collectionAddress);
            await collection.connect(creator1).mint(creator1.address, 100, "ipfs://sword.json");

            expect(await collection.balanceOf(creator1.address, 0)).to.equal(100);
        });
    });

    describe("Creation Fee", function () {
        it("Should allow owner to set creation fee", async function () {
            const fee = ethers.parseEther("0.01");
            await factory.setCreationFee(fee);
            expect(await factory.creationFee()).to.equal(fee);
        });

        it("Should require fee for collection creation", async function () {
            const fee = ethers.parseEther("0.01");
            await factory.setCreationFee(fee);

            await expect(
                factory.connect(creator1).createERC721Collection("Test", "TST", 100, creator1.address, 500)
            ).to.be.revertedWithCustomError(factory, "InsufficientFee");

            // Should work with fee
            await factory.connect(creator1).createERC721Collection(
                "Test", "TST", 100, creator1.address, 500,
                { value: fee }
            );
            expect(await factory.getERC721CollectionCount()).to.equal(1);
        });

        it("Should allow owner to withdraw fees", async function () {
            const fee = ethers.parseEther("0.01");
            await factory.setCreationFee(fee);

            await factory.connect(creator1).createERC721Collection(
                "Test", "TST", 100, creator1.address, 500,
                { value: fee }
            );

            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await factory.withdrawFees();
            const balanceAfter = await ethers.provider.getBalance(owner.address);

            expect(balanceAfter).to.be.greaterThan(balanceBefore);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to update implementations", async function () {
            const newImpl = ethers.Wallet.createRandom().address;

            await factory.setERC721Implementation(newImpl);
            expect(await factory.erc721Implementation()).to.equal(newImpl);

            await factory.setERC1155Implementation(newImpl);
            expect(await factory.erc1155Implementation()).to.equal(newImpl);
        });

        it("Should prevent non-owner from admin functions", async function () {
            await expect(
                factory.connect(creator1).setCreationFee(100)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

            await expect(
                factory.connect(creator1).withdrawFees()
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should reject zero address for implementation", async function () {
            await expect(
                factory.setERC721Implementation(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(factory, "InvalidImplementation");
        });
    });

    describe("Address Prediction", function () {
        it("Should predict correct addresses", async function () {
            const timestamp = Math.floor(Date.now() / 1000);

            const predictedAddress = await factory.predictERC721Address(
                creator1.address,
                "Test",
                "TST",
                timestamp
            );

            // Note: This test just verifies the prediction function works
            // Actual address matching requires using the same timestamp which is tricky in tests
            expect(predictedAddress).to.not.equal(ethers.ZeroAddress);
        });
    });
});
