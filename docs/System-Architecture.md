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

## Implementation Status

### ✅ Production Ready (Integrated & Tested)

| Contract | Tests | Status |
|----------|-------|--------|
| ERC721NFT.sol | 23 | ✅ Ready |
| ERC1155NFT.sol | 24 | ✅ Ready |
| NFTFactory.sol | 15 | ✅ Ready |
| Marketplace.sol | 27 | ✅ Ready |
| AuctionEngine.sol | 30 | ✅ Ready |
| **TOTAL** | **119** | ✅ **All Passing** |

### ⚠️ Standalone Proof-of-Concept (NOT Integrated)

| Contract | Tests | Integration |
|----------|-------|-------------|
| LazyMinting.sol | 0 | ❌ Standalone |
| FractionalVault.sol | 0 | ❌ Standalone |
| MetaTransactionHandler.sol | 0 | ❌ Standalone |

### ❌ Not Implemented

| Feature | Phase | Notes |
|---------|-------|-------|
| Bundle Sales | Phase 4 | Not in Marketplace |
| Vickrey Auction | Phase 6 | Not in AuctionEngine |
| Deployment Scripts | Phase 10 | `/scripts/` empty |
| Frontend | Phase 10 | Not started |

---

## Directory Structure

```
NFT-marketplace/
├── contracts/
│   ├── core/
│   │   ├── NFTFactory.sol          # ✅ Production
│   │   ├── Marketplace.sol         # ✅ Production
│   │   └── AuctionEngine.sol       # ✅ Production
│   │
│   ├── tokens/
│   │   ├── erc721/
│   │   │   ├── ERC721NFT.sol              # ✅ Production
│   │   │   └── ERC721NFTInitializable.sol # ✅ Production
│   │   └── erc1155/
│   │       ├── ERC1155NFT.sol             # ✅ Production
│   │       └── ERC1155NFTInitializable.sol # ✅ Production
│   │
│   ├── advanced/
│   │   ├── LazyMinting.sol          # ⚠️ Standalone
│   │   ├── FractionalVault.sol      # ⚠️ Standalone
│   │   └── MetaTransactionHandler.sol # ⚠️ Standalone
│   │
│   ├── auctions/     # ❌ Empty
│   ├── bridge/       # ❌ Empty
│   ├── fractional/   # ❌ Empty
│   ├── interfaces/   # ❌ Empty
│   └── libraries/    # ❌ Empty
│
├── test/
│   ├── ERC721NFT.test.js      # 23 tests ✅
│   ├── ERC1155NFT.test.js     # 24 tests ✅
│   ├── NFTFactory.test.js     # 15 tests ✅
│   ├── Marketplace.test.js    # 27 tests ✅
│   └── AuctionEngine.test.js  # 30 tests ✅
│
├── scripts/          # ❌ Empty (no deploy scripts)
│
└── docs/
    ├── ERC721NFT-Explained.md
    ├── ERC1155NFT-Explained.md
    ├── NFTFactory-Explained.md
    ├── Initializable-Contracts-Explained.md
    ├── Marketplace-Explained.md
    ├── AuctionEngine-Explained.md
    ├── LazyMinting-Explained.md
    ├── FractionalVault-Explained.md
    ├── MetaTransactionHandler-Explained.md
    ├── Gas-Optimization-Report.md
    ├── Advanced-Features-Integration-Plan.md
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
| **Bundle Sales** | ❌ Not implemented | ❌ N/A |
| **Vickrey Auction** | ❌ N/A | ❌ Not implemented |

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

> ⚠️ **Note:** Deployment scripts not yet created. `/scripts/` directory is empty.

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

## Gas Optimizations Applied

| Optimization | Status | Details |
|--------------|--------|---------|
| **Custom Errors** | ✅ Complete | 19 require statements converted (~200 gas/call) |
| **Calldata Params** | ✅ Complete | 9 string params in NFTFactory (~60 gas/param) |
| **viaIR Compiler** | ✅ Enabled | Better optimization for complex structs |
| **Storage Packing** | ⚠️ Partial | Structs reasonably packed |
| **Unchecked Math** | ❌ Pending | Could add to loops |

See [Gas-Optimization-Report.md](./Gas-Optimization-Report.md) for full details.

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

---

## Remaining Work

### High Priority
1. Create deployment scripts
2. Deploy to Sepolia testnet
3. Run security analysis (Slither/Mythril)

### Medium Priority
4. Implement bundle sales
5. Write tests for advanced contracts
6. Integrate LazyMinting with Marketplace

### Low Priority
7. Implement Vickrey auction
8. Integrate FractionalVault
9. Build relayer for MetaTransactionHandler
10. Build frontend
