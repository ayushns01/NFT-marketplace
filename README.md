# NFT Marketplace

## Overview

A Solidity smart contract project exploring NFT marketplace mechanics, auction mechanisms, and DeFi primitives. Built as a learning exercise to understand:

- NFT trading (ERC-721 & ERC-1155)
- Various auction types (English, Dutch, Vickrey sealed-bid)
- AMM concepts (bonding curves)
- NFT fractionalization
- Meta-transactions & lazy minting
- Upgradeable contract patterns (UUPS)

## Project Structure

```
contracts/
├── core/           # Marketplace, AuctionEngine, NFTFactory
├── advanced/       # BondingCurve, FractionalVault, VickreyAuction, LazyMinting
├── tokens/         # ERC721 & ERC1155 implementations
├── interfaces/     # Contract interfaces
└── mocks/          # Test mocks
```

## Features Implemented

| Feature | Contract | Status |
|---------|----------|--------|
| Fixed-price listings | `Marketplace.sol` | ✅ Complete |
| ERC-20 payments | `MarketplaceV2.sol` | ✅ Complete |
| English auctions | `AuctionEngine.sol` | ✅ Complete |
| Dutch auctions | `AuctionEngine.sol` | ✅ Complete |
| Vickrey sealed-bid | `VickreyAuction.sol` | ✅ Complete |
| Bonding curves | `BondingCurve.sol` | ✅ Complete |
| NFT fractionalization | `FractionalVault.sol` | ✅ Complete |
| Lazy minting (EIP-712) | `LazyMinting.sol` | ✅ Complete |
| Meta-transactions | `MetaTransactionHandler.sol` | ✅ Complete |
| UUPS upgradeability | `MarketplaceV2.sol` | ✅ Complete |

## Known Limitations & Security Notes

This project is for **learning purposes**. Known issues include:

- No formal security audit
- Limited invariant/fuzz testing on financial logic
- Some contracts may have unaddressed edge cases
- Gas optimization is not prioritized
- Not tested against MEV/sandwich attacks

See the code comments for specific areas that would need hardening for production use.

## Installation

```bash
# Clone the repository
git clone https://github.com/ayushns01/NFT-marketplace.git
cd NFT-marketplace

# Install dependencies
npm install

# Compile contracts
npm run compile
```

## Testing

```bash
# Run all tests
npm test

# Run tests with gas reporting
npm run test:gas

# Run coverage
npm run coverage
```

## Local Deployment

```bash
# Start local node
npx hardhat node

# Deploy to local network
npm run deploy:local
```

## Tech Stack

- **Solidity** ^0.8.20
- **Hardhat** - Development framework
- **OpenZeppelin** v5.4 - Contract libraries
- **Ethers.js** v6 - Ethereum interactions

## Learning Resources

This project was built while learning from:
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [Solidity by Example](https://solidity-by-example.org/)
- [Foundry Book](https://book.getfoundry.sh/)

## License

ISC
