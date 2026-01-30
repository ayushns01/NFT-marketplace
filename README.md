# NFT Marketplace

## Overview

A comprehensive Solidity smart contract project implementing a full-featured NFT marketplace with multiple trading mechanisms, auction types, and DeFi primitives. Built with security-first design patterns including:

- NFT trading (ERC-721 & ERC-1155) with royalty support (EIP-2981)
- Various auction types (English, Dutch, Vickrey sealed-bid)
- AMM concepts (bonding curves with linear/exponential pricing)
- NFT fractionalization with pro-rata buyout distribution
- Meta-transactions & lazy minting (EIP-712)
- Upgradeable contract patterns (UUPS with timelock)
- Protocol-wide emergency controls

## Project Structure

```
contracts/
├── core/           # Marketplace, MarketplaceV2, AuctionEngine, NFTFactory, ProtocolRegistry
├── advanced/       # BondingCurve, FractionalVault, VickreyAuction, LazyMinting, MetaTransactionHandler
├── tokens/         # ERC721 & ERC1155 implementations (standard + initializable)
├── interfaces/     # Contract interfaces (IAuction, IMarketplaceHook)
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
| Protocol emergency pause | `ProtocolRegistry.sol` | ✅ Complete |
| Clone factory pattern | `NFTFactory.sol` | ✅ Complete |

## Security Features

### Design Patterns
- ✅ **Checks-Effects-Interactions** - Consistent CEI pattern across all contracts
- ✅ **Pull over Push** - Pending withdrawals for safe payment distribution
- ✅ **Reentrancy Guards** - All external value transfers protected
- ✅ **Flash Loan Protection** - Same-block purchase restrictions on listings/auctions

### Critical Fixes Implemented
- ✅ **FractionalVault mapping collision** - Fixed to support multiple tokens per NFT contract
- ✅ **BondingCurve ownership verification** - Added NFT ownership checks before transfers
- ✅ **Royalty caps** - Limited to 10% to prevent malicious NFT contracts
- ✅ **UUPS upgrade timelock** - Enforced 2-day delay on upgrades
- ✅ **VickreyAuction deposit reclaim** - Functions for unrevealed and losing bidders
- ✅ **Slippage protection** - Added to BondingCurve buy/sell operations
- ✅ **Batch operation bounds** - Limited to 100 items to prevent gas exhaustion
- ✅ **DoS prevention** - Pull-pattern for creator/seller payments in BondingCurve & VickreyAuction
- ✅ **Per-vault balance tracking** - Prevents cross-vault fund theft in FractionalVault
- ✅ **Cross-chain replay protection** - ChainId validation in meta-transactions

### Testing
- ✅ **Unit tests** - Hardhat tests covering all contracts
- ✅ **Invariant tests** - Foundry property-based tests for financial logic
- ✅ **Static analysis** - Slither integration in CI (GitHub Actions)

> ⚠️ **WARNING**: This project has NOT been professionally audited. See [SECURITY.md](SECURITY.md) for details.

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

```bash
# Start local node
npx hardhat node

# Deploy to local network
npm run deploy:local
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
- **Hardhat** - Development framework & testing
- **Foundry** - Invariant/fuzz testing
- **OpenZeppelin** v5.x - Contract libraries (standard + upgradeable)
- **Ethers.js** v6 - Ethereum interactions

## Architecture Highlights

| Pattern | Implementation |
|---------|---------------|
| Pull Payments | `pendingWithdrawals` mappings prevent DoS |
| Clone Factory | `NFTFactory` uses minimal proxies (EIP-1167) |
| UUPS Upgrades | `MarketplaceV2` with 2-day timelock |
| Role-Based Access | `AccessControl` in MarketplaceV2 & ProtocolRegistry |
| EIP-712 Signatures | Typed data signing for lazy minting & meta-tx |

## Learning Resources

This project was built while learning from:
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [Solidity by Example](https://solidity-by-example.org/)
- [Foundry Book](https://book.getfoundry.sh/)
- [Consensys Smart Contract Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## License

ISC
