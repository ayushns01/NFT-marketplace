# ERC1155NFT Contract Explained

## What is ERC-1155?

ERC-1155 is the **multi-token standard**. One contract can manage multiple token types, each with its own supply.

**Example**: A game with:
- Sword (Token ID 0) - 1000 copies
- Shield (Token ID 1) - 500 copies  
- Rare Potion (Token ID 2) - 50 copies

All managed by ONE contract!

---

## ERC-721 vs ERC-1155

| Feature | ERC-721 | ERC-1155 |
|---------|---------|----------|
| Token types | One type per contract | Multiple types per contract |
| Supply | 1 per token ID | Many per token ID |
| Use case | Unique art, PFPs | Games, editions, collectibles |
| Batch transfer | ❌ One at a time | ✅ Multiple at once |
| Gas efficiency | Lower | Higher |

---

## Contract Structure

```solidity
contract ERC1155NFT is ERC1155, ERC1155Burnable, ERC1155Supply, Ownable, Pausable, ERC2981
```

### Inherited Contracts:

| Contract | What It Adds |
|----------|--------------|
| `ERC1155` | Multi-token functionality |
| `ERC1155Burnable` | Destroy tokens |
| `ERC1155Supply` | Track total supply per token ID |
| `Ownable` | Admin functions |
| `Pausable` | Emergency stop |
| `ERC2981` | Royalties |

---

## State Variables

```solidity
string public name;                              // Collection name
string public symbol;                            // Collection symbol
uint256 private _tokenIdCounter;                 // Next token ID
mapping(uint256 => string) private _tokenURIs;   // URI per token ID
mapping(uint256 => uint256) public maxSupplyPerToken;  // Max supply per token
mapping(address => bool) public whitelist;       // Minting permission
bool public whitelistEnabled;                    // Whitelist active?
```

### Key Difference from ERC-721:

**ERC-721**: One URI per token (each unique)
**ERC-1155**: One URI per token **type** (all copies share same metadata)

---

## Constructor

```solidity
constructor(
    string memory name_,
    string memory symbol_,
    string memory baseURI_,
    address royaltyReceiver,
    uint96 royaltyFeeNumerator
) ERC1155(baseURI_) Ownable(msg.sender)
```

**Example deployment:**
```javascript
await ERC1155NFT.deploy(
    "Game Items",       // name
    "ITEM",             // symbol
    "ipfs://base/",     // base URI
    "0x123...",         // royalty receiver
    500                 // 5% royalty
);
```

---

## Minting Functions

### 1. Mint New Token Type

```solidity
function mint(address to, uint256 amount, string memory tokenURI_) 
    public whenNotPaused returns (uint256)
```

**Creates a NEW token type and mints copies.**

```javascript
// Create Token ID 0 with 100 copies
await nft.mint(addr1, 100, "ipfs://sword-metadata.json");
// Returns: 0 (the new token ID)

// Create Token ID 1 with 50 copies
await nft.mint(addr1, 50, "ipfs://shield-metadata.json");
// Returns: 1
```

**Result:**
- Token 0: 100 Swords exist
- Token 1: 50 Shields exist

---

### 2. Mint More of Existing Token

```solidity
function mintExisting(address to, uint256 tokenId, uint256 amount) public whenNotPaused
```

**Adds more copies of existing token type.**

```javascript
// Token 0 has 100 swords
await nft.mintExisting(addr2, 0, 50);  // Mint 50 more swords
// Now Token 0 has 150 total swords
```

---

### 3. Batch Mint (Most Efficient)

```solidity
function mintBatch(address to, uint256[] memory amounts, string[] memory tokenURIs) 
    public whenNotPaused returns (uint256[] memory)
```

**Create multiple token types at once.**

```javascript
const amounts = [100, 50, 25];
const uris = [
    "ipfs://sword.json",
    "ipfs://shield.json",
    "ipfs://potion.json"
];

await nft.mintBatch(addr1, amounts, uris);
// Creates:
// Token 0: 100 copies
// Token 1: 50 copies
// Token 2: 25 copies
```

---

## Max Supply Per Token

```solidity
function setMaxSupply(uint256 tokenId, uint256 maxSupply) external onlyOwner
```

**Limit how many of each token type can exist.**

```javascript
// Token 0 (Common Sword): Unlimited
// Token 1 (Rare Sword): Max 100
await nft.setMaxSupply(1, 100);

// After 100 minted, this fails:
await nft.mintExisting(addr1, 1, 1);  // Error: MaxSupplyReached
```

---

## Per-Token Royalties

```solidity
function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner
```

**Different royalties for different tokens!**

```javascript
// Default: 5% to creator
// Rare items: 10% to artist
await nft.setTokenRoyalty(5, artistAddress, 1000);  // 10% for rare token
```

**Use case:**
- Common items: 5% royalty
- Rare items: 10% royalty
- Legendary items: 15% royalty

---

## URI Management

### How URIs Work:

```solidity
function uri(uint256 tokenId) public view override returns (string memory)
```

**Priority:**
1. Token-specific URI (if set)
2. Base URI (fallback)

```javascript
// Token 0 has specific URI
await nft.mint(addr1, 100, "ipfs://special.json");
await nft.uri(0);  // Returns: "ipfs://special.json"

// Token 1 has empty URI, uses base
await nft.mint(addr1, 50, "");
await nft.uri(1);  // Returns: "ipfs://base/" (from constructor)
```

### Update URIs:

```javascript
// Update specific token
await nft.setTokenURI(0, "ipfs://updated.json");

// Update base for all
await nft.setBaseURI("ipfs://new-base/");
```

---

## Transfers

### Single Transfer

```javascript
await nft.safeTransferFrom(from, to, tokenId, amount, "0x");
// Transfer 10 swords (token 0) from Alice to Bob
```

### Batch Transfer (Gas Efficient!)

```javascript
await nft.safeBatchTransferFrom(
    from,
    to,
    [0, 1, 2],      // token IDs
    [10, 5, 2],     // amounts
    "0x"
);
// Transfer 10 swords, 5 shields, 2 potions in ONE transaction!
```

---

## Burning

### Single Burn

```javascript
await nft.burn(ownerAddress, tokenId, amount);
// Destroy 5 swords
await nft.connect(owner).burn(owner.address, 0, 5);
```

### Batch Burn

```javascript
await nft.burnBatch(ownerAddress, [0, 1], [5, 3]);
// Destroy 5 swords and 3 shields
```

---

## Balance Checking

```javascript
// Check single token balance
const swords = await nft.balanceOf(user, 0);

// Check multiple balances at once
const balances = await nft.balanceOfBatch(
    [user, user, user],
    [0, 1, 2]
);
// Returns: [swords, shields, potions]
```

---

## Supply Tracking

```javascript
// Total supply of token type
const totalSwords = await nft["totalSupply(uint256)"](0);

// Check if token exists
const exists = await nft.exists(0);  // true if any minted

// Total number of token types created
const types = await nft.totalTokenTypes();
```

---

## Function Override: _update

```solidity
function _update(
    address from,
    address to,
    uint256[] memory ids,
    uint256[] memory values
) internal override(ERC1155, ERC1155Supply) whenNotPaused
```

**Why this exists:**
- Both `ERC1155` and `ERC1155Supply` have `_update`
- We combine them with `override(ERC1155, ERC1155Supply)`
- Add `whenNotPaused` to stop transfers when paused

---

## Complete Example Flow

```javascript
// 1. Deploy contract
const nft = await ERC1155NFT.deploy("GameItems", "ITEM", "ipfs://", owner, 500);

// 2. Create token types
await nft.mint(treasury, 1000, "ipfs://sword.json");    // Token 0: 1000 swords
await nft.mint(treasury, 500, "ipfs://shield.json");    // Token 1: 500 shields
await nft.mint(treasury, 100, "ipfs://potion.json");    // Token 2: 100 potions

// 3. Set max supply for rare items
await nft.setMaxSupply(2, 100);  // Only 100 potions ever

// 4. Transfer to players
await nft.safeTransferFrom(treasury, player1, 0, 1, "0x");  // 1 sword
await nft.safeBatchTransferFrom(
    treasury, player2, 
    [0, 1], [2, 1],  // 2 swords + 1 shield
    "0x"
);

// 5. Player uses (burns) potion
await nft.connect(player1).burn(player1, 2, 1);  // Use 1 potion

// 6. Check balances
console.log(await nft.balanceOf(player1, 0));  // Swords owned
console.log(await nft["totalSupply(uint256)"](2));  // Total potions remaining
```

---

## Gas Comparison

| Operation | ERC-721 | ERC-1155 |
|-----------|---------|----------|
| Mint 10 tokens | ~900k gas | ~150k gas |
| Transfer 5 tokens | ~350k gas | ~80k gas |
| Check 3 balances | 3 calls | 1 call |

**ERC-1155 is ~5-6x more gas efficient for batch operations!**

---

## Summary

| Feature | Description |
|---------|-------------|
| **Multi-token** | One contract, many token types |
| **Supply per token** | Each type has its own supply |
| **Batch operations** | Mint/transfer/burn multiple at once |
| **Per-token royalties** | Different % for different tokens |
| **Max supply per token** | Limit each type individually |
| **Gas efficient** | 5-6x cheaper for batch ops |

---

## When to Use ERC-1155

✅ **Use ERC-1155 for:**
- Game items (weapons, armor, consumables)
- Music editions (1000 copies of an album)
- Event tickets (section A, B, C)
- Semi-fungible tokens (same type, different ID)

❌ **Use ERC-721 for:**
- Unique 1/1 art pieces
- Profile pictures (PFPs)
- Domain names
- Anything truly unique
