# System Architecture

## Complete System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NFT MARKETPLACE PLATFORM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         ┌─────────────────────┐                             │
│                         │     NFTFactory      │                             │
│                         │  Creates Collections │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                         │
│              ┌─────────────────────┼─────────────────────┐                  │
│              ▼                     ▼                     ▼                  │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐         │
│   │ ERC721 Clone 1  │   │ ERC721 Clone 2  │   │ ERC1155 Clone 1 │         │
│   │ (Collection A)  │   │ (Collection B)  │   │ (Game Items)    │         │
│   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘         │
│            │                     │                     │                    │
│            └─────────────────────┼─────────────────────┘                    │
│                                  │                                          │
│              ┌───────────────────┴───────────────────┐                     │
│              ▼                                       ▼                     │
│   ┌─────────────────────────┐         ┌─────────────────────────┐         │
│   │      MARKETPLACE        │         │     AUCTION ENGINE      │         │
│   │  Fixed-Price Trading    │         │   Time-Based Bidding    │         │
│   │                         │         │                         │         │
│   │  • List NFTs            │         │  • English Auctions     │         │
│   │  • Buy at set price     │         │  • Dutch Auctions       │         │
│   │  • Make/Accept offers   │         │  • Anti-sniping         │         │
│   └─────────────────────────┘         └─────────────────────────┘         │
│              │                                       │                     │
│              └───────────────────┬───────────────────┘                     │
│                                  │                                          │
│            ┌─────────────────────┼─────────────────────┐                   │
│            ▼                     ▼                     ▼                   │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐        │
│   │  Platform Fee   │   │ Creator Royalty │   │ Seller Payment  │        │
│   │     (2.5%)      │   │ (EIP-2981: 5%)  │   │    (92.5%)      │        │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Contract Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONTRACTS MAP                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   IMPLEMENTATIONS (Templates - Deployed Once)                               │
│   ┌─────────────────────────┐   ┌─────────────────────────┐                │
│   │ERC721NFTInitializable   │   │ERC1155NFTInitializable  │                │
│   │ • mint(), transfer()    │   │ • mint(), mintBatch()   │                │
│   │ • royaltyInfo()         │   │ • royaltyInfo()         │                │
│   └────────────┬────────────┘   └────────────┬────────────┘                │
│                │                             │                              │
│                └───────────┬─────────────────┘                              │
│                            ▼                                                 │
│   FACTORY                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         NFTFactory.sol                               │  │
│   │   createERC721Collection() ──► Clones ERC721 Implementation         │  │
│   │   createERC1155Collection() ─► Clones ERC1155 Implementation        │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                            │                                                 │
│                    creates │ collections                                     │
│                            ▼                                                 │
│   COLLECTIONS (Clones - Many Instances)                                     │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│   │ Collection A  │ │ Collection B  │ │ Collection C  │ │ Game Items    │ │
│   │ (ERC721)      │ │ (ERC721)      │ │ (ERC721)      │ │ (ERC1155)     │ │
│   └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ │
│           │                 │                 │                 │          │
│           └─────────────────┴─────────────────┴─────────────────┘          │
│                                       │                                     │
│              ┌────────────────────────┴─────────────────────────┐          │
│              │                                                   │          │
│   TRADING PLATFORMS                                                         │
│   ┌──────────────────────────────────┐  ┌──────────────────────────────┐  │
│   │         Marketplace.sol          │  │       AuctionEngine.sol      │  │
│   │                                  │  │                               │  │
│   │  Fixed-Price:                    │  │  Time-Based:                  │  │
│   │  • listERC721/1155()            │  │  • createEnglishAuction()    │  │
│   │  • buy()                         │  │  • createDutchAuction()      │  │
│   │  • makeOffer() / acceptOffer()   │  │  • placeBid()                │  │
│   │  • cancelListing()               │  │  • endAuction()              │  │
│   └──────────────────────────────────┘  └──────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
NFT-marketplace/
├── contracts/
│   ├── core/
│   │   ├── NFTFactory.sol          # Creates new collections
│   │   ├── Marketplace.sol         # Fixed-price trading
│   │   └── AuctionEngine.sol       # Auction trading (NEW!)
│   │
│   └── tokens/
│       ├── erc721/
│       │   ├── ERC721NFT.sol              # Standalone ERC-721
│       │   └── ERC721NFTInitializable.sol # For factory clones
│       │
│       └── erc1155/
│           ├── ERC1155NFT.sol             # Standalone ERC-1155
│           └── ERC1155NFTInitializable.sol # For factory clones
│
├── test/
│   ├── ERC721NFT.test.js      # 23 tests
│   ├── ERC1155NFT.test.js     # 24 tests
│   ├── NFTFactory.test.js     # 15 tests
│   ├── Marketplace.test.js    # 27 tests
│   └── AuctionEngine.test.js  # 30 tests (NEW!)
│
└── docs/
    ├── ERC721NFT-Explained.md
    ├── ERC1155NFT-Explained.md
    ├── NFTFactory-Explained.md
    ├── Initializable-Contracts-Explained.md
    ├── Marketplace-Explained.md
    ├── AuctionEngine-Explained.md (NEW!)
    └── System-Architecture.md (this file)
```

---

## Trading Options Comparison

| Feature | Marketplace | AuctionEngine |
|---------|-------------|---------------|
| **Pricing** | Fixed | Dynamic |
| **Duration** | Until sold/cancelled | Time-limited |
| **Buyer** | First to pay | Highest bidder / First buyer |
| **Offers** | ✅ Yes | ❌ No (bids instead) |
| **Reserve** | ❌ No | ✅ Yes |
| **Anti-sniping** | ❌ N/A | ✅ Yes |

---

## Deployment Sequence

```
Step 1: Deploy Token Implementations (ONCE)
┌─────────────────────────────────────────────────────────────┐
│ 1. ERC721NFTInitializable.deploy()    → 0x111...           │
│ 2. ERC1155NFTInitializable.deploy()   → 0x222...           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 2: Deploy Factory (ONCE)
┌─────────────────────────────────────────────────────────────┐
│ 3. NFTFactory.deploy(0x111, 0x222)    → 0x333...           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 3: Deploy Trading Platforms (ONCE)
┌─────────────────────────────────────────────────────────────┐
│ 4. Marketplace.deploy(250, owner)     → 0x444...           │
│ 5. AuctionEngine.deploy(250, owner)   → 0x555...           │
│    (250 = 2.5% platform fee)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 4: Users Create & Trade (ONGOING)
┌─────────────────────────────────────────────────────────────┐
│ • Users create collections via factory                      │
│ • Users mint NFTs in their collections                      │
│ • Users list on marketplace OR create auctions              │
│ • Buyers purchase or bid                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Complete User Journeys

### Journey 1: Fixed-Price Sale

```
Alice creates collection → mints NFT → lists on Marketplace → Bob buys
```

### Journey 2: Auction Sale

```
Alice creates collection → mints NFT → creates auction → 
Bob bids 1 ETH → Carol bids 1.2 ETH → auction ends → Carol wins
```

### Journey 3: Dutch Auction

```
Alice creates Dutch auction (2 ETH → 0.5 ETH) → 
Price drops to 1 ETH → Bob buys immediately → Auction ends
```

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SECURITY FEATURES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   All Contracts                                                              │
│   ├── Ownable: Admin functions restricted                                   │
│   ├── Pausable: Emergency stop                                              │
│   └── Custom Errors: Gas-efficient error handling                           │
│                                                                              │
│   Token Contracts (ERC721/1155)                                             │
│   ├── Whitelist: Control who can mint                                       │
│   ├── Max Supply: Prevent infinite minting                                  │
│   └── EIP-2981: Standard royalty support                                    │
│                                                                              │
│   NFTFactory                                                                 │
│   ├── Creation fee: Prevents collection spam                                │
│   └── Initializer: Clones can only be initialized once                      │
│                                                                              │
│   Marketplace                                                                │
│   ├── ReentrancyGuard: Prevent reentrancy                                   │
│   ├── Escrow: NFTs held during listing                                      │
│   └── Fee Cap: Platform fee max 10%                                        │
│                                                                              │
│   AuctionEngine                                                              │
│   ├── ReentrancyGuard: Prevent reentrancy                                   │
│   ├── Pull Payments: Users withdraw outbid funds                           │
│   ├── Reserve Price: Seller protection                                      │
│   └── Anti-sniping: Fair bidding window                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Test Coverage

| Contract | Tests | Status |
|----------|-------|--------|
| ERC721NFT | 23 | ✅ Passing |
| ERC1155NFT | 24 | ✅ Passing |
| NFTFactory | 15 | ✅ Passing |
| Marketplace | 27 | ✅ Passing |
| AuctionEngine | 30 | ✅ Passing |
| **TOTAL** | **119** | ✅ **All Passing** |

---

## Gas Costs (Estimated @ 30 gwei)

| Operation | Gas | Cost |
|-----------|-----|------|
| Deploy Implementation | ~2,500,000 | ~$75 (once) |
| Clone Collection | ~200,000 | ~$6 |
| Mint ERC721 | ~100,000 | ~$3 |
| List on Marketplace | ~150,000 | ~$4.50 |
| Buy from Marketplace | ~200,000 | ~$6 |
| Create Auction | ~180,000 | ~$5.50 |
| Place Bid | ~80,000 | ~$2.50 |
| End Auction | ~200,000 | ~$6 |
