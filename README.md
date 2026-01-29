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

## Security Improvements

Critical bugs fixed based on professional audit:
- ✅ **FractionalVault mapping collision** - Fixed to support multiple tokens per NFT contract
- ✅ **BondingCurve ownership verification** - Added NFT ownership checks before transfers
- ✅ **Royalty caps implemented** - Limited to 10% to prevent malicious NFT contracts
- ✅ **UUPS upgrade timelock** - Enforced 2-day delay on upgrades
- ✅ **VickreyAuction deposit reclaim** - Added function for unrevealed bidders
- ✅ **Slippage protection** - Added to BondingCurve.sell()
- ✅ **Batch operation bounds** - Limited to 100 items to prevent gas exhaustion
- ✅ **Invariant tests added** - Foundry tests for critical financial invariants

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
# Run Hardhat tests
npm test

# Run tests with gas reporting
npm run test:gas

# Run coverage
npm run coverage

# Run Foundry invariant tests
forge test --match-path "test/invariant/*.sol" -vvv

# Run Slither static analysis
slither . --filter-paths "node_modules|lib" --exclude naming-convention
```

## Local Deployment

```

## Testnet Deployments

### Sepolia (Ethereum Testnet)

Deployment planned for Q1 2026. This section will be updated with verified contract addresses.

**Planned contracts:**
- Marketplace
- MarketplaceV2 (UUPS Proxy)
- AuctionEngine
- NFTFactory
- FractionalVault
- LazyMinting
- BondingCurve
- VickreyAuction

**Deployment checklist:**
- [ ] Deploy to Sepolia testnet
- [ ] Verify contracts on Etherscan
- [ ] Test all major flows with real transactions
- [ ] Document gas costs for each operation
- [ ] Create deployment postmortem

To deploy when ready:
```bash
# Set environment variables in .env
SEPOLIA_RPC_URL=<your_infura/alchemy_url>
PRIVATE_KEY=<deployer_private_key>
ETHERSCAN_API_KEY=<your_etherscan_key>

# Deploy to Sepolia
npm run deploy:sepolia
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
