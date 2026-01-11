# Marketplace.sol - Complete Guide

## What is the Marketplace?

The Marketplace is the **heart of the NFT platform** - where buyers and sellers meet to trade NFTs.

```
┌─────────────────────────────────────────────────────────────────┐
│                         MARKETPLACE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Sellers                           Buyers                       │
│   ┌─────────┐                       ┌─────────┐                 │
│   │  List   │                       │  Buy    │                 │
│   │  NFTs   │ ────────────────────► │  NFTs   │                 │
│   └─────────┘                       └─────────┘                 │
│        │                                  │                      │
│        │         ┌───────────────┐       │                      │
│        └────────►│  Marketplace  │◄──────┘                      │
│                  │   Contract    │                               │
│                  └───────────────┘                               │
│                         │                                        │
│         ┌───────────────┼───────────────┐                       │
│         ▼               ▼               ▼                        │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                   │
│   │ Platform │   │ Creator  │   │  Seller  │                   │
│   │   Fee    │   │ Royalty  │   │ Payment  │                   │
│   └──────────┘   └──────────┘   └──────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **List NFTs** | Sell ERC-721 and ERC-1155 tokens |
| **Fixed Price** | Set your price, buyer pays that amount |
| **Offers** | Buyers can make offers, sellers can accept |
| **Royalties** | Auto-pays creators via EIP-2981 |
| **Platform Fee** | Marketplace takes a small cut |
| **Pausable** | Admin can pause in emergencies |

---

## Data Structures

### Listing

```solidity
struct Listing {
    address seller;       // Who listed it
    address nftContract;  // NFT contract address
    uint256 tokenId;      // Which token
    uint256 amount;       // Quantity (1 for ERC721, any for ERC1155)
    uint256 price;        // Price in wei
    TokenType tokenType;  // ERC721 or ERC1155
    ListingStatus status; // Active, Sold, or Cancelled
    uint256 createdAt;    // Timestamp
}
```

### Offer

```solidity
struct Offer {
    address buyer;     // Who made the offer
    uint256 price;     // Amount offered (held in contract)
    uint256 expiresAt; // When offer expires (0 = never)
    bool accepted;     // Was it accepted?
}
```

---

## Listing an NFT

### ERC-721 Listing

```solidity
function listERC721(
    address nftContract,
    uint256 tokenId,
    uint256 price
) external returns (uint256 listingId)
```

**Flow:**
```
1. Seller approves marketplace: nft.setApprovalForAll(marketplace, true)
2. Seller calls listERC721()
3. NFT transfers from seller → marketplace (escrow)
4. Listing created with status = Active
5. Returns listingId
```

**Example:**
```javascript
// Approve marketplace
await nft.setApprovalForAll(marketplaceAddress, true);

// List NFT for 1 ETH
const tx = await marketplace.listERC721(
    nftAddress,
    tokenId,
    ethers.parseEther("1")
);
// listingId = 0
```

### ERC-1155 Listing

```solidity
function listERC1155(
    address nftContract,
    uint256 tokenId,
    uint256 amount,   // How many tokens
    uint256 price     // Price for ALL of them
) external returns (uint256 listingId)
```

**Example:**
```javascript
// List 50 swords for 0.5 ETH total
await marketplace.listERC1155(
    gameItemsAddress,
    0,                         // swordTokenId
    50,                        // amount
    ethers.parseEther("0.5")   // price for all 50
);
```

---

## Buying

```solidity
function buy(uint256 listingId) external payable
```

**Flow:**
```
Buyer sends ETH
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  Marketplace receives payment                                │
│                                                              │
│  Calculate fees:                                             │
│  ├── Platform fee (2.5%)                                    │
│  ├── Creator royalty (5%) ← from EIP-2981                   │
│  └── Seller amount (92.5%)                                  │
│                                                              │
│  Transfer NFT: Marketplace → Buyer                          │
│  Send ETH to: Platform, Creator, Seller                     │
│                                                              │
│  Mark listing as Sold                                        │
└─────────────────────────────────────────────────────────────┘
```

**Example:**
```javascript
// Buy listing #0 for its listed price
await marketplace.connect(buyer).buy(0, { 
    value: ethers.parseEther("1") 
});
```

---

## Fee Distribution

```
Sale Price: 1 ETH
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌────────────────┐                                         │
│  │ Platform Fee   │  2.5% = 0.025 ETH → Marketplace Owner   │
│  └────────────────┘                                         │
│                                                              │
│  ┌────────────────┐                                         │
│  │ Creator Royalty│  5.0% = 0.050 ETH → Original Creator    │
│  └────────────────┘                                         │
│                                                              │
│  ┌────────────────┐                                         │
│  │ Seller Payment │ 92.5% = 0.925 ETH → NFT Seller          │
│  └────────────────┘                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Code:**
```solidity
uint256 platformAmount = (price * platformFee) / 10000;  // 250/10000 = 2.5%

// Get royalty from NFT contract (EIP-2981)
(address royaltyRecipient, uint256 royaltyAmount) = 
    IERC2981(nftContract).royaltyInfo(tokenId, price);

uint256 sellerAmount = price - platformAmount - royaltyAmount;
```

---

## Offer System

### Making an Offer

```solidity
function makeOffer(uint256 listingId, uint256 expiresAt) external payable
```

- Buyer sends ETH with the call (held in contract)
- `expiresAt` = 0 means never expires

**Example:**
```javascript
// Offer 0.8 ETH, expires in 24 hours
const expiresAt = Math.floor(Date.now() / 1000) + 86400;
await marketplace.connect(buyer).makeOffer(0, expiresAt, {
    value: ethers.parseEther("0.8")
});
```

### Accepting an Offer

```solidity
function acceptOffer(uint256 listingId, uint256 offerIndex) external
```

- Only seller can accept
- Executes sale at offer price
- ETH distributed same as regular sale

### Cancelling an Offer

```solidity
function cancelOffer(uint256 listingId, uint256 offerIndex) external
```

- Only buyer can cancel
- ETH refunded to buyer

---

## Managing Listings

### Update Price

```solidity
function updatePrice(uint256 listingId, uint256 newPrice) external
```

```javascript
// Change price to 2 ETH
await marketplace.connect(seller).updatePrice(0, ethers.parseEther("2"));
```

### Cancel Listing

```solidity
function cancelListing(uint256 listingId) external
```

- Returns NFT to seller
- Marks listing as Cancelled

```javascript
await marketplace.connect(seller).cancelListing(0);
// NFT returned to seller
```

---

## Security Features

| Feature | Protection |
|---------|------------|
| **ReentrancyGuard** | Prevents reentrancy attacks |
| **Pausable** | Admin can stop all trading |
| **Custom Errors** | Gas-efficient error handling |
| **Escrow** | NFTs held by contract during listing |
| **Fee Cap** | Platform fee max 10% |

---

## Admin Functions

| Function | Purpose |
|----------|---------|
| `setPlatformFee(uint256)` | Change fee (max 1000 = 10%) |
| `setFeeRecipient(address)` | Change who receives fees |
| `pause()` | Stop all trading |
| `unpause()` | Resume trading |

---

## View Functions

```solidity
// Get listing details
function getListing(uint256 listingId) returns (Listing)

// Get all offers on a listing
function getOffers(uint256 listingId) returns (Offer[])

// Get all listings by a user
function getUserListings(address user) returns (uint256[])

// Get total number of listings
function getTotalListings() returns (uint256)
```

---

## Complete Trading Flow

```
1. SETUP
   Seller: nft.setApprovalForAll(marketplace, true)

2. LIST
   Seller: marketplace.listERC721(nft, tokenId, price)
   → NFT moves to marketplace
   → listingId = 0

3. OFFERS (optional)
   Buyer: marketplace.makeOffer(0, expiresAt, {value: 0.8 ETH})
   → ETH held in contract

4. SALE (either method)
   Option A: Buyer buys at full price
             marketplace.buy(0, {value: 1 ETH})
   
   Option B: Seller accepts offer
             marketplace.acceptOffer(0, 0)

5. DISTRIBUTION
   → NFT: Marketplace → Buyer
   → ETH: Buyer → Platform (2.5%)
   → ETH: Buyer → Creator (5%)
   → ETH: Buyer → Seller (92.5%)

6. DONE
   Listing status = Sold
```

---

## Events

```solidity
event Listed(listingId, seller, nftContract, tokenId, amount, price, tokenType)
event Sale(listingId, seller, buyer, price)
event ListingCancelled(listingId)
event ListingUpdated(listingId, newPrice)
event OfferCreated(listingId, buyer, price, expiresAt)
event OfferAccepted(listingId, buyer, price)
event OfferCancelled(listingId, offerIndex)
```

Use these to track activity:
```javascript
marketplace.on("Sale", (listingId, seller, buyer, price) => {
    console.log(`Token sold for ${ethers.formatEther(price)} ETH!`);
});
```
