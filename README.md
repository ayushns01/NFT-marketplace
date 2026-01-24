# 🎨 NFT Marketplace

> A Solidity-based NFT marketplace supporting ERC-721 & ERC-1155 with auctions, royalty enforcement, lazy minting, and fractional ownership.

## ⚠️ Work In Progress

This project is under active development. Some features are implemented, others are planned. See the feature matrix below.

---

## ✅ Implemented Features

### Core Contracts
| Feature | Status | Contract |
|---------|--------|----------|
| ERC-721 token minting | ✅ Done | `ERC721NFT.sol`, `ERC721NFTInitializable.sol` |
| ERC-1155 token minting | ✅ Done | `ERC1155NFT.sol`, `ERC1155NFTInitializable.sol` |
| NFT Factory (clone pattern) | ✅ Done | `NFTFactory.sol` |
| Marketplace (buy/sell/list) | ✅ Done | `Marketplace.sol` |
| Offer system | ✅ Done | `Marketplace.sol` |
| EIP-2981 royalties | ✅ Done | All token contracts |

### Auction System
| Feature | Status | Contract |
|---------|--------|----------|
| English auctions | ✅ Done | `AuctionEngine.sol` |
| Dutch auctions | ✅ Done | `AuctionEngine.sol` |
| Anti-sniping mechanism | ✅ Done | `AuctionEngine.sol` |
| Reserve prices | ✅ Done | `AuctionEngine.sol` |

### Advanced Features
| Feature | Status | Contract |
|---------|--------|----------|
| Lazy minting (EIP-712) | ✅ Done | `LazyMinting.sol` |
| Meta-transactions (EIP-712) | ✅ Done | `MetaTransactionHandler.sol` |
| Fractional ownership | ✅ Done | `FractionalVault.sol` |

### Security
- ✅ Reentrancy guards (OpenZeppelin)
- ✅ Access control (Ownable/AccessControl)
- ✅ Pausable contracts
- ✅ Custom errors for gas efficiency
- ✅ Slither static analysis performed

---

## � Not Yet Implemented

The following features are **planned but not yet built**:

- ❌ Cross-chain bridge
- ❌ Vickrey (sealed-bid) auctions
- ❌ Bonding curve pricing
- ❌ Rarity oracle
- ❌ AI content verification
- ❌ Frontend application
- ❌ The Graph subgraph
- ❌ Backend API

---

## 📁 Project Structure

```
contracts/
├── core/
│   ├── Marketplace.sol      # Buy/sell/list NFTs, offers
│   ├── NFTFactory.sol       # Clone-based collection deployment
│   └── AuctionEngine.sol    # English & Dutch auctions
├── advanced/
│   ├── FractionalVault.sol  # Fractionalize NFTs into ERC-20 shares
│   ├── LazyMinting.sol      # Gas-free minting with signatures
│   └── MetaTransactionHandler.sol # Gasless meta-transactions
├── tokens/
│   ├── erc721/              # ERC-721 implementations
│   └── erc1155/             # ERC-1155 implementations
└── mocks/                   # Test helper contracts

test/
├── Marketplace.test.js
├── AuctionEngine.test.js
├── NFTFactory.test.js
├── FractionalVault.test.js
├── LazyMinting.test.js
└── MetaTransactionHandler.test.js
```

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
npm >= 9.0.0
```

### Installation

```bash
# Clone repository
git clone https://github.com/ayushns01/NFT-marketplace.git
cd NFT-marketplace

# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm run test

# Run with gas reporting
npm run test:gas

# Run coverage
npm run coverage
```

### Deployment

```bash
# Deploy to Sepolia testnet
npm run deploy:sepolia

# Deploy to Polygon
npm run deploy:polygon

# Deploy locally
npm run deploy:local
```

---

## 🧪 Testing

The project includes comprehensive tests for all contracts:

```bash
# Run all tests
npm run test

# Run with coverage report
npm run coverage

# Run with gas reporting
npm run test:gas

# Run specific test
npx hardhat test test/FractionalVault.test.js
```

---

## 📊 Gas Optimization Techniques Used

1. **Custom Errors** - Gas-efficient error handling
2. **Calldata** - Used for read-only parameters
3. **Storage Packing** - Optimized struct layouts
4. **Unchecked Math** - Where overflow is impossible
5. **Clone Pattern** - Minimal proxy for NFT collections

---

## 🔒 Security Notes

- All contracts use OpenZeppelin's security primitives
- Static analysis performed with Slither
- Locked Solidity version (0.8.20)
- CEI pattern followed in state changes

### Known Considerations

- `block.timestamp` used for auction timing (acceptable for ~15s precision)
- Meta-transactions require trusted relayer setup

---

## 📜 License

MIT
