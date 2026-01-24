/**
 * NFT Marketplace Deployment Script
 * 
 * Deploys all core contracts to the specified network.
 * 
 * Usage:
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   npx hardhat run scripts/deploy.js --network polygon
 *   npx hardhat run scripts/deploy.js --network hardhat
 */

const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());
    console.log("Network:", hre.network.name);
    console.log("---");

    // Configuration
    const PLATFORM_FEE = 250; // 2.5%
    const ROYALTY_FEE = 500;  // 5%
    
    // 1. Deploy Token Implementations (for factory cloning)
    console.log("1. Deploying ERC721NFTInitializable implementation...");
    const ERC721NFTInitializable = await hre.ethers.getContractFactory("ERC721NFTInitializable");
    const erc721Implementation = await ERC721NFTInitializable.deploy();
    await erc721Implementation.waitForDeployment();
    console.log("   ERC721NFTInitializable:", await erc721Implementation.getAddress());

    console.log("2. Deploying ERC1155NFTInitializable implementation...");
    const ERC1155NFTInitializable = await hre.ethers.getContractFactory("ERC1155NFTInitializable");
    const erc1155Implementation = await ERC1155NFTInitializable.deploy();
    await erc1155Implementation.waitForDeployment();
    console.log("   ERC1155NFTInitializable:", await erc1155Implementation.getAddress());

    // 2. Deploy NFTFactory
    console.log("3. Deploying NFTFactory...");
    const NFTFactory = await hre.ethers.getContractFactory("NFTFactory");
    const nftFactory = await NFTFactory.deploy(
        await erc721Implementation.getAddress(),
        await erc1155Implementation.getAddress()
    );
    await nftFactory.waitForDeployment();
    console.log("   NFTFactory:", await nftFactory.getAddress());

    // 3. Deploy Marketplace
    console.log("4. Deploying Marketplace...");
    const Marketplace = await hre.ethers.getContractFactory("Marketplace");
    const marketplace = await Marketplace.deploy(PLATFORM_FEE, deployer.address);
    await marketplace.waitForDeployment();
    console.log("   Marketplace:", await marketplace.getAddress());

    // 4. Deploy AuctionEngine
    console.log("5. Deploying AuctionEngine...");
    const AuctionEngine = await hre.ethers.getContractFactory("AuctionEngine");
    const auctionEngine = await AuctionEngine.deploy(PLATFORM_FEE, deployer.address);
    await auctionEngine.waitForDeployment();
    console.log("   AuctionEngine:", await auctionEngine.getAddress());

    // 5. Deploy FractionalVault
    console.log("6. Deploying FractionalVault...");
    const FractionalVault = await hre.ethers.getContractFactory("FractionalVault");
    const fractionalVault = await FractionalVault.deploy();
    await fractionalVault.waitForDeployment();
    console.log("   FractionalVault:", await fractionalVault.getAddress());

    // 6. Deploy LazyMinting
    console.log("7. Deploying LazyMinting...");
    const LazyMinting = await hre.ethers.getContractFactory("LazyMinting");
    const lazyMinting = await LazyMinting.deploy(PLATFORM_FEE, deployer.address);
    await lazyMinting.waitForDeployment();
    console.log("   LazyMinting:", await lazyMinting.getAddress());

    // 7. Deploy MetaTransactionHandler
    console.log("8. Deploying MetaTransactionHandler...");
    const MetaTransactionHandler = await hre.ethers.getContractFactory("MetaTransactionHandler");
    const metaTxHandler = await MetaTransactionHandler.deploy();
    await metaTxHandler.waitForDeployment();
    console.log("   MetaTransactionHandler:", await metaTxHandler.getAddress());

    // Summary
    console.log("\n=== DEPLOYMENT SUMMARY ===");
    console.log("Network:", hre.network.name);
    console.log("Deployer:", deployer.address);
    console.log("");
    console.log("Implementations:");
    console.log("  ERC721NFTInitializable:", await erc721Implementation.getAddress());
    console.log("  ERC1155NFTInitializable:", await erc1155Implementation.getAddress());
    console.log("");
    console.log("Core Contracts:");
    console.log("  NFTFactory:", await nftFactory.getAddress());
    console.log("  Marketplace:", await marketplace.getAddress());
    console.log("  AuctionEngine:", await auctionEngine.getAddress());
    console.log("");
    console.log("Advanced Contracts:");
    console.log("  FractionalVault:", await fractionalVault.getAddress());
    console.log("  LazyMinting:", await lazyMinting.getAddress());
    console.log("  MetaTransactionHandler:", await metaTxHandler.getAddress());
    console.log("===========================");

    // Return addresses for verification script
    return {
        erc721Implementation: await erc721Implementation.getAddress(),
        erc1155Implementation: await erc1155Implementation.getAddress(),
        nftFactory: await nftFactory.getAddress(),
        marketplace: await marketplace.getAddress(),
        auctionEngine: await auctionEngine.getAddress(),
        fractionalVault: await fractionalVault.getAddress(),
        lazyMinting: await lazyMinting.getAddress(),
        metaTxHandler: await metaTxHandler.getAddress()
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
