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
│              │                     │                     │                  │
│              ▼                     ▼                     ▼                  │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐         │
│   │ ERC721 Clone 1  │   │ ERC721 Clone 2  │   │ ERC1155 Clone 1 │         │
│   │ (Collection A)  │   │ (Collection B)  │   │ (Game Items)    │         │
│   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘         │
│            │                     │                     │                    │
│            └─────────────────────┼─────────────────────┘                    │
│                                  │                                          │
│                                  ▼                                          │
│                    ┌─────────────────────────┐                             │
│                    │      MARKETPLACE        │                             │
│                    │  List • Buy • Offers    │                             │
│                    └─────────────────────────┘                             │
│                                  │                                          │
│            ┌─────────────────────┼─────────────────────┐                   │
│            ▼                     ▼                     ▼                   │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐        │
│   │  Platform Fee   │   │ Creator Royalty │   │ Seller Payment  │        │
│   │     (2.5%)      │   │     (5%)        │   │    (92.5%)      │        │
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
│   IMPLEMENTATIONS (Templates)                                                │
│   ┌─────────────────────────┐   ┌─────────────────────────┐                │
│   │ERC721NFTInitializable   │   │ERC1155NFTInitializable  │                │
│   │ • mint()                │   │ • mint()                │                │
│   │ • transfer()            │   │ • mintBatch()           │                │
│   │ • royaltyInfo()         │   │ • royaltyInfo()         │                │
│   └────────────┬────────────┘   └────────────┬────────────┘                │
│                │                             │                              │
│                └───────────┬─────────────────┘                              │
│                            │                                                 │
│                            ▼                                                 │
│   FACTORY                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         NFTFactory.sol                               │  │
│   │                                                                      │  │
│   │   createERC721Collection() ──► Clones ERC721 Implementation         │  │
│   │   createERC1155Collection() ─► Clones ERC1155 Implementation        │  │
│   │                                                                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                            │                                                 │
│                    creates │ collections                                     │
│                            ▼                                                 │
│   COLLECTIONS (Clones/Proxies)                                              │
│   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│   │ Collection A  │ │ Collection B  │ │ Collection C  │ │ Game Items    │ │
│   │ (ERC721)      │ │ (ERC721)      │ │ (ERC721)      │ │ (ERC1155)     │ │
│   │ Owner: Alice  │ │ Owner: Bob    │ │ Owner: Carol  │ │ Owner: Dave   │ │
│   └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ │
│           │                 │                 │                 │          │
│           └─────────────────┴─────────────────┴─────────────────┘          │
│                                       │                                     │
│                               listed on│                                    │
│                                       ▼                                     │
│   MARKETPLACE                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         Marketplace.sol                              │  │
│   │                                                                      │  │
│   │   listERC721()     ─► Create fixed-price listing                    │  │
│   │   listERC1155()    ─► Create fixed-price listing                    │  │
│   │   buy()            ─► Purchase at listed price                      │  │
│   │   makeOffer()      ─► Submit offer with ETH                         │  │
│   │   acceptOffer()    ─► Seller accepts offer                          │  │
│   │   cancelListing()  ─► Return NFT to seller                          │  │
│   │                                                                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
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
│   │   └── Marketplace.sol         # Trading platform
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
│   └── Marketplace.test.js    # 27 tests
│
└── docs/
    ├── ERC721NFT-Explained.md
    ├── ERC1155NFT-Explained.md
    ├── NFTFactory-Explained.md
    ├── Initializable-Contracts-Explained.md
    ├── Marketplace-Explained.md
    └── System-Architecture.md (this file)
```

---

## Data Flow: Complete Trading Cycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE TRADING CYCLE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. CREATE COLLECTION                                                        │
│     ┌─────────┐                    ┌─────────────┐                          │
│     │  Alice  │ ── createERC721 ──►│  NFTFactory │                          │
│     └─────────┘    Collection()    └──────┬──────┘                          │
│                                           │                                  │
│                                           ▼                                  │
│                               ┌─────────────────────┐                       │
│                               │ New Collection Clone│                       │
│                               │ Owner: Alice        │                       │
│                               └─────────────────────┘                       │
│                                                                              │
│  2. MINT NFT                                                                 │
│     ┌─────────┐                    ┌─────────────────────┐                  │
│     │  Alice  │ ── mint() ────────►│ Collection (Alice's)│                  │
│     └─────────┘                    │ tokenId: 0          │                  │
│                                    └─────────────────────┘                  │
│                                                                              │
│  3. LIST ON MARKETPLACE                                                      │
│     ┌─────────┐                    ┌─────────────┐                          │
│     │  Alice  │ ── listERC721() ──►│ Marketplace │                          │
│     └─────────┘    (1 ETH)         └──────┬──────┘                          │
│                                           │                                  │
│                                    NFT moves to                              │
│                                    marketplace (escrow)                      │
│                                                                              │
│  4. BUYER PURCHASES                                                          │
│     ┌─────────┐                    ┌─────────────┐                          │
│     │   Bob   │ ── buy() + 1 ETH ─►│ Marketplace │                          │
│     └─────────┘                    └──────┬──────┘                          │
│                                           │                                  │
│                        ┌──────────────────┼──────────────────┐              │
│                        ▼                  ▼                  ▼              │
│                 ┌────────────┐    ┌────────────┐    ┌────────────┐         │
│                 │ 0.025 ETH  │    │ 0.05 ETH   │    │ 0.925 ETH  │         │
│                 │ Platform   │    │ Creator    │    │ Seller     │         │
│                 └────────────┘    └────────────┘    └────────────┘         │
│                                                                              │
│  5. NFT TRANSFERRED                                                          │
│                    ┌─────────────────────┐                                  │
│                    │ NFT now owned by Bob│                                  │
│                    └─────────────────────┘                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Sequence

```
Step 1: Deploy Implementations (ONCE)
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
Step 3: Deploy Marketplace (ONCE)
┌─────────────────────────────────────────────────────────────┐
│ 4. Marketplace.deploy(250, owner)     → 0x444...           │
│    (250 = 2.5% platform fee)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Step 4: Users Create & Trade (MANY TIMES)
┌─────────────────────────────────────────────────────────────┐
│ • Users create collections via factory                      │
│ • Users mint NFTs in their collections                      │
│ • Users list NFTs on marketplace                            │
│ • Users buy/sell NFTs                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SECURITY FEATURES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   NFTFactory                                                                 │
│   ├── Ownable: Only owner can update implementations                        │
│   ├── Creation fee: Prevents spam                                           │
│   └── Initializer: Clones can only be initialized once                      │
│                                                                              │
│   Token Contracts (ERC721/1155)                                             │
│   ├── Ownable: Admin functions restricted                                   │
│   ├── Pausable: Emergency stop                                              │
│   ├── Whitelist: Control who can mint                                       │
│   └── Max Supply: Prevent infinite minting                                  │
│                                                                              │
│   Marketplace                                                                │
│   ├── ReentrancyGuard: Prevent reentrancy attacks                          │
│   ├── Pausable: Emergency stop                                              │
│   ├── Escrow: NFTs held by contract during listing                         │
│   ├── Fee Cap: Platform fee max 10%                                        │
│   └── Custom Errors: Gas-efficient error handling                           │
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
| **TOTAL** | **89** | ✅ **All Passing** |

---

## Gas Costs (Estimated)

| Operation | Gas | Cost @ 30 gwei |
|-----------|-----|----------------|
| Deploy Implementation | ~2,500,000 | ~$75 (once) |
| Clone Collection | ~200,000 | ~$6 |
| Mint ERC721 | ~100,000 | ~$3 |
| List NFT | ~150,000 | ~$4.50 |
| Buy NFT | ~200,000 | ~$6 |
| Accept Offer | ~220,000 | ~$6.60 |

---

## Quick Reference

```javascript
// 1. SETUP (Deploy once)
const erc721Impl = await ERC721NFTInitializable.deploy();
const erc1155Impl = await ERC1155NFTInitializable.deploy();
const factory = await NFTFactory.deploy(erc721Impl, erc1155Impl);
const marketplace = await Marketplace.deploy(250, owner); // 2.5% fee

// 2. CREATE COLLECTION
const tx = await factory.createERC721Collection("MyNFT", "NFT", 10000, creator, 500);
const collectionAddress = /* from event */;

// 3. MINT NFT
const collection = await ethers.getContractAt("ERC721NFTInitializable", collectionAddress);
await collection.mint(owner, "ipfs://metadata.json");

// 4. APPROVE & LIST
await collection.setApprovalForAll(marketplace, true);
await marketplace.listERC721(collectionAddress, tokenId, ethers.parseEther("1"));

// 5. BUY
await marketplace.connect(buyer).buy(listingId, { value: ethers.parseEther("1") });
```
