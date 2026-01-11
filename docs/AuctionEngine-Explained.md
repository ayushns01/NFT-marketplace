# AuctionEngine.sol - Complete Guide

## What is the Auction Engine?

The Auction Engine enables **time-based competitive bidding** for NFTs, offering alternatives to fixed-price sales.

```
┌─────────────────────────────────────────────────────────────────┐
│                       AUCTION ENGINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ENGLISH AUCTION              DUTCH AUCTION                    │
│   (Ascending Bids)             (Descending Price)               │
│                                                                  │
│   Price ▲                      Price ▲                          │
│         │    ╭──●              │  ●                             │
│         │   ╭╯                 │   ╲                            │
│         │  ╭╯                  │    ╲                           │
│         │ ●                    │     ╲──●                       │
│         └──────────► Time      └──────────► Time                │
│                                                                  │
│   Bids go UP                   Price goes DOWN                  │
│   Highest bid wins             First buyer wins                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Auction Types

### 1. English Auction (Classic)

The traditional auction format where bidders compete by placing increasingly higher bids.

```
Timeline:
├── Start: 1 ETH minimum
├── Bid: Alice → 1 ETH ✓
├── Bid: Bob → 1.1 ETH ✓ (5% higher)
├── Bid: Alice → 1.2 ETH ✓
├── End Time reached
└── Winner: Alice (highest bidder)
```

**Key Features:**
- Start price = minimum first bid
- Each bid must be 5%+ higher than previous
- Reserve price (optional) = minimum to complete sale
- Anti-sniping extends auction on late bids

### 2. Dutch Auction (Descending)

Price starts high and decreases over time. First buyer wins.

```
Timeline:
├── Start: 2 ETH
├── 6 hours later: 1.5 ETH
├── 12 hours later: 1 ETH
├── Bob buys at 1 ETH ✓
└── Auction ends immediately
```

**Key Features:**
- Price decreases linearly over time
- First valid bid wins
- No bidding war - just timing
- Good for price discovery

---

## Data Structures

### Auction

```solidity
struct Auction {
    address seller;        // Who created the auction
    address nftContract;   // NFT contract address
    uint256 tokenId;       // Token being auctioned
    uint256 amount;        // Quantity (1 for ERC721)
    TokenType tokenType;   // ERC721 or ERC1155
    AuctionType auctionType; // English or Dutch
    AuctionStatus status;  // Active, Ended, Cancelled
    uint256 startPrice;    // Starting/minimum price
    uint256 reservePrice;  // Min price to complete (English)
    uint256 endPrice;      // Final price (Dutch)
    uint256 startTime;     // When auction started
    uint256 endTime;       // When auction ends
    address highestBidder; // Current winning bidder
    uint256 highestBid;    // Current highest bid
}
```

---

## Creating Auctions

### English Auction

```solidity
function createEnglishAuction(
    address nftContract,
    uint256 tokenId,
    uint256 startPrice,    // Minimum first bid
    uint256 reservePrice,  // Min to complete (0 = no reserve)
    uint256 duration       // How long auction runs
) returns (uint256 auctionId)
```

**Example:**
```javascript
// Approve auction contract first
await nft.setApprovalForAll(auctionEngine, true);

// Create 24-hour auction, start at 1 ETH, reserve at 2 ETH
await auctionEngine.createEnglishAuction(
    nftAddress,
    tokenId,
    ethers.parseEther("1"),   // start price
    ethers.parseEther("2"),   // reserve price
    86400                      // 24 hours
);
```

### Dutch Auction

```solidity
function createDutchAuction(
    address nftContract,
    uint256 tokenId,
    uint256 startPrice,  // Initial (high) price
    uint256 endPrice,    // Final (low) price
    uint256 duration     // Time to reach end price
) returns (uint256 auctionId)
```

**Example:**
```javascript
// Price drops from 2 ETH to 0.5 ETH over 24 hours
await auctionEngine.createDutchAuction(
    nftAddress,
    tokenId,
    ethers.parseEther("2"),    // start price
    ethers.parseEther("0.5"),  // end price
    86400                       // 24 hours
);
```

---

## Bidding

### Place a Bid

```solidity
function placeBid(uint256 auctionId) external payable
```

**English Auction:**
```javascript
// First bid must meet start price
await auctionEngine.connect(alice).placeBid(0, { 
    value: ethers.parseEther("1") 
});

// Next bid must be 5%+ higher
await auctionEngine.connect(bob).placeBid(0, { 
    value: ethers.parseEther("1.1") 
});
// Alice's 1 ETH goes to pendingReturns
```

**Dutch Auction:**
```javascript
// Get current price
const price = await auctionEngine.getDutchPrice(auctionId);

// Buy at current price
await auctionEngine.connect(buyer).placeBid(auctionId, { 
    value: price 
});
// NFT transfers immediately, auction ends
```

---

## Anti-Sniping Protection

Prevents last-second bids that don't give others time to respond.

```
Without Anti-Sniping:            With Anti-Sniping:
├── 23:59:55 - Bob bids         ├── 23:59:55 - Bob bids
├── 24:00:00 - Auction ends     ├── Auction extends 10 min
├── Bob wins (unfair!)          ├── 24:09:55 - Alice can counter
                                ├── 24:10:00 - Auction ends fairly
```

**How it works:**
- If bid placed within last 10 minutes
- Auction extends by 10 more minutes
- Gives everyone fair chance to respond

---

## Reserve Price

Minimum price for the auction to complete.

```
Auction with 2 ETH Reserve:

Scenario A: Reserve Met
├── Highest bid: 2.5 ETH ✓
├── Reserve: 2 ETH
├── Winner gets NFT ✓
└── Seller gets 2.5 ETH ✓

Scenario B: Reserve Not Met
├── Highest bid: 1.5 ETH ✗
├── Reserve: 2 ETH
├── NFT returns to seller
└── Bid refunded to bidder
```

---

## Ending & Settlement

### End Auction

```solidity
function endAuction(uint256 auctionId) external
```

Anyone can call after auction time expires:

```javascript
// Wait for auction to end
await time.increase(86400);

// Settle the auction
await auctionEngine.endAuction(auctionId);
```

**What happens:**
1. If bids exist AND reserve met → NFT to winner, payment distributed
2. If no bids OR reserve not met → NFT returns to seller, bids refunded

---

## Fee Distribution

Same as Marketplace:

```
Winning Bid: 1 ETH
┌─────────────────────────────────────────────────────────────┐
│  Platform Fee (2.5%): 0.025 ETH → Auction owner            │
│  Creator Royalty (5%): 0.05 ETH → Original creator         │
│  Seller Payment: 0.925 ETH → Auction seller                │
└─────────────────────────────────────────────────────────────┘
```

---

## Pending Returns

Outbid users have their ETH stored for withdrawal:

```javascript
// Check pending returns
const pending = await auctionEngine.pendingReturns(alice.address);

// Withdraw
await auctionEngine.connect(alice).withdrawPendingReturns();
```

**Why not auto-refund?**
- Gas savings (push vs pull pattern)
- Security (reentrancy protection)

---

## Complete Auction Flow

```
1. SETUP
   Seller: nft.setApprovalForAll(auctionEngine, true)

2. CREATE AUCTION
   Seller: auctionEngine.createEnglishAuction(...)
   → NFT moves to auction contract
   → Returns auctionId

3. BIDDING PERIOD
   Bidder1: placeBid(id, {value: 1 ETH})
   Bidder2: placeBid(id, {value: 1.1 ETH})
   → Bidder1's ETH goes to pendingReturns
   
   Late bid (within 10 min of end):
   → Auction extended by 10 minutes

4. END AUCTION
   Anyone: endAuction(id) after endTime

5. SETTLEMENT
   If reserve met:
   → NFT: Auction → Winner
   → ETH: Winner → Platform (2.5%) + Creator (5%) + Seller (92.5%)
   
   If reserve not met:
   → NFT: Auction → Seller
   → ETH: Winner's bid → pendingReturns

6. WITHDRAWALS
   Outbid users: withdrawPendingReturns()
```

---

## Admin Functions

| Function | Purpose |
|----------|---------|
| `setPlatformFee(uint256)` | Change fee (max 10%) |
| `setFeeRecipient(address)` | Change fee recipient |
| `setAntiSnipingDuration(uint256)` | Change anti-snipe window |
| `setMinBidIncrement(uint256)` | Change min bid increase % |
| `pause()` / `unpause()` | Emergency stop |

---

## View Functions

```solidity
// Get auction details
function getAuction(uint256 auctionId) returns (Auction)

// Get current Dutch auction price
function getDutchPrice(uint256 auctionId) returns (uint256)

// Check if auction is still active
function isActive(uint256 auctionId) returns (bool)

// Get total auctions created
function getTotalAuctions() returns (uint256)

// Check pending returns for user
mapping(address => uint256) public pendingReturns
```

---

## Security Features

| Feature | Protection |
|---------|------------|
| **ReentrancyGuard** | Prevents reentrancy attacks |
| **Pausable** | Emergency stop |
| **Pull Payments** | Outbid users withdraw (not auto-send) |
| **NFT Escrow** | NFT held by contract during auction |
| **Time Checks** | Can't bid on expired auctions |
| **Reserve Price** | Sellers protected from low sales |
