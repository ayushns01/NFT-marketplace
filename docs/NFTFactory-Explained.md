# NFT Factory - Complete Guide

## What is NFT Factory?

NFTFactory is a **contract that deploys other contracts**. Instead of manually deploying each NFT collection, users can call one function and get a new collection instantly.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         NFT Factory                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User calls: createERC721Collection("MyNFTs", "MNFT", ...)      │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ 1. Clone implementation (EIP-1167)                   │       │
│  │ 2. Initialize clone with user's parameters           │       │
│  │ 3. Transfer ownership to user                        │       │
│  │ 4. Track collection in registry                      │       │
│  └──────────────────────────────────────────────────────┘       │
│                              │                                   │
│                              ▼                                   │
│  New Collection: 0xABC... (owned by user)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## EIP-1167: Minimal Proxy (Clones)

Instead of deploying full contract code each time, we use **Clones**:

```solidity
import "@openzeppelin/contracts/proxy/Clones.sol";

// Deploy a clone that delegates to implementation
address clone = erc721Implementation.cloneDeterministic(salt);
```

### Gas Savings:

| Method | Gas Cost | Time |
|--------|----------|------|
| Full deployment | ~2,500,000 | Expensive |
| Clone deployment | ~200,000 | **92% cheaper** |

---

## Contract Structure

```solidity
contract NFTFactory is Ownable {
    // Implementation contracts (templates)
    address public erc721Implementation;
    address public erc1155Implementation;
    
    // Optional fee for creating collections
    uint256 public creationFee;
    
    // Track all deployed collections
    address[] public deployedERC721Collections;
    address[] public deployedERC1155Collections;
    
    // Track collections by creator
    mapping(address => address[]) public creatorToCollections;
    
    // Verify if address is factory-created
    mapping(address => bool) public isFactoryCollection;
}
```

---

## Creating an ERC-721 Collection

```solidity
function createERC721Collection(
    string memory name,
    string memory symbol,
    uint256 maxSupply,
    address royaltyReceiver,
    uint96 royaltyFee
) external payable returns (address)
```

### Step-by-Step:

1. **Check fee** - User must pay creation fee (if set)
2. **Generate salt** - Unique identifier for deterministic address
3. **Clone** - Create minimal proxy pointing to implementation
4. **Initialize** - Call `initialize()` with user's parameters
5. **Track** - Add to registry and emit event
6. **Return** - Return new collection address

### Usage:

```javascript
// Create a new NFT collection
const tx = await factory.createERC721Collection(
    "Awesome Apes",      // name
    "APES",              // symbol
    10000,               // max supply
    creator.address,     // royalty receiver
    500                  // 5% royalty
);

// Get collection address from event
const receipt = await tx.wait();
// Collection is now live at returned address!
```

---

## Creating an ERC-1155 Collection

```solidity
function createERC1155Collection(
    string memory name,
    string memory symbol,
    string memory baseURI,
    address royaltyReceiver,
    uint96 royaltyFee
) external payable returns (address)
```

### Usage:

```javascript
const tx = await factory.createERC1155Collection(
    "Game Items",
    "ITEM",
    "ipfs://base/",
    creator.address,
    500
);
```

---

## Address Prediction

Predict a collection's address before deployment:

```solidity
function predictERC721Address(
    address creator,
    string memory name,
    string memory symbol,
    uint256 timestamp
) external view returns (address)
```

### Use Case:

- Pre-approve addresses in other contracts
- Generate vanity addresses
- Frontend can show address before deployment

---

## Admin Functions

| Function | Purpose |
|----------|---------|
| `setCreationFee(uint256)` | Set fee for creating collections |
| `setERC721Implementation(address)` | Update ERC-721 template |
| `setERC1155Implementation(address)` | Update ERC-1155 template |
| `withdrawFees()` | Collect accumulated fees |

---

## Query Functions

```solidity
// Get total collection counts
factory.getERC721CollectionCount();   // Returns: 42
factory.getERC1155CollectionCount();  // Returns: 15

// Get all collections by a creator
factory.getCollectionsByCreator(userAddress);  // Returns: [addr1, addr2, ...]

// Check if collection was factory-created
factory.isFactoryCollection(collectionAddress);  // Returns: true/false
```

---

## Complete Flow Example

```javascript
// 1. Deploy factory (once)
const factory = await NFTFactory.deploy(
    erc721Impl.address,
    erc1155Impl.address
);

// 2. User creates collection
const tx = await factory.connect(creator).createERC721Collection(
    "My NFTs",
    "MNFT",
    1000,
    creator.address,
    500
);

// 3. Get collection address
const receipt = await tx.wait();
const event = receipt.logs.find(log => 
    factory.interface.parseLog(log)?.name === "ERC721CollectionCreated"
);
const collectionAddress = factory.interface.parseLog(event).args.collection;

// 4. Creator can now use their collection
const collection = await ethers.getContractAt("ERC721NFTInitializable", collectionAddress);

// 5. Mint NFTs
await collection.connect(creator).mint(buyer.address, "ipfs://metadata.json");
```

---

## Why Use Factory Pattern?

| Benefit | Explanation |
|---------|-------------|
| **Gas efficient** | 92% cheaper to deploy collections |
| **Consistent** | All collections follow same standard |
| **Upgradeable** | Can update implementation for new collections |
| **Trackable** | Registry of all collections |
| **Monetizable** | Collect fees per collection |
| **Verified** | Easy to verify factory-created collections |
