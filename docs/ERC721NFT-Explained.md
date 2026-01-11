# ERC721NFT Contract Explained

## What is ERC-721?

ERC-721 is the standard for **unique, non-fungible tokens (NFTs)**. Each token is one-of-a-kind.

**Example**: A unique piece of digital art. Token #1 is different from Token #2.

---

## Contract Structure

```solidity
contract ERC721NFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, Pausable, ERC2981
```

### Inherited Contracts:

| Contract | What It Adds |
|----------|--------------|
| `ERC721` | Basic NFT functionality (transfer, ownerOf, balanceOf) |
| `ERC721URIStorage` | Store unique metadata URI per token |
| `ERC721Burnable` | Destroy tokens permanently |
| `Ownable` | Only owner can call certain functions |
| `Pausable` | Emergency stop all transfers |
| `ERC2981` | Royalty information standard |

---

## State Variables

```solidity
uint256 private _tokenIdCounter;        // Next token ID to mint
uint256 public maxSupply;               // Maximum tokens allowed (0 = unlimited)
string private _baseTokenURI;           // Base URL for all token metadata
mapping(address => bool) public whitelist;  // Addresses allowed to mint
bool public whitelistEnabled;           // Is whitelist active?
```

### Understanding Each:

**`_tokenIdCounter`** - Tracks which token ID to assign next
- Starts at 0
- Increments after each mint
- Token IDs: 0, 1, 2, 3...

**`maxSupply`** - Limits total tokens
- Set to 0 for unlimited
- Prevents minting beyond this number

**`whitelist`** - A mapping (like a dictionary)
- `whitelist[0x123...] = true` means address can mint
- `whitelist[0x456...] = false` means address cannot mint

---

## Custom Errors

```solidity
error MaxSupplyReached();
error NotWhitelisted();
error InvalidQuantity();
error InvalidAddress();
error InvalidTokenId();
```

**Why custom errors?**
- Save gas (no string storage)
- Cleaner error handling
- Each costs ~24 gas vs ~50+ for `require` with string

---

## Constructor

```solidity
constructor(
    string memory name_,
    string memory symbol_,
    uint256 maxSupply_,
    address royaltyReceiver,
    uint96 royaltyFeeNumerator
) ERC721(name_, symbol_) Ownable(msg.sender)
```

**Called once when deploying. Sets up:**
1. Collection name (e.g., "Bored Apes")
2. Symbol (e.g., "BAYC")
3. Max supply (e.g., 10000)
4. Royalty receiver address
5. Royalty percentage (500 = 5%)

**Example deployment:**
```javascript
await ERC721NFT.deploy(
    "My Collection",    // name
    "MYC",              // symbol
    10000,              // max supply
    "0x123...",         // royalty receiver
    500                 // 5% royalty
);
```

---

## Minting Functions

### Single Mint

```solidity
function mint(address to, string memory uri) public whenNotPaused returns (uint256)
```

**What happens step by step:**

1. **Check pause state** - `whenNotPaused` modifier
2. **Validate address** - Cannot mint to zero address
3. **Check whitelist** - If enabled, sender must be whitelisted
4. **Check max supply** - Cannot exceed limit
5. **Get next token ID** - `tokenId = _tokenIdCounter++`
6. **Mint token** - `_safeMint(to, tokenId)`
7. **Set metadata** - `_setTokenURI(tokenId, uri)`
8. **Emit event** - Log the mint
9. **Return token ID**

**Usage:**
```javascript
await nft.mint("0x123...", "ipfs://QmXyz.../metadata.json");
// Returns: 0 (first token ID)
```

---

### Batch Mint (Gas Optimized)

```solidity
function batchMint(address to, uint256 quantity, string memory baseURI) 
    public whenNotPaused returns (uint256 startTokenId)
```

**Why batch mint?**
- Minting 10 individually: ~970,800 gas
- Batch minting 10: ~583,420 gas
- **Saves 40%!**

**How it works:**

```solidity
unchecked {
    for (uint256 i = 0; i < quantity; i++) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, string(abi.encodePacked(baseURI, _toString(tokenId))));
    }
}
```

**`unchecked` block** - Skips overflow checks
- Safe because we control the loop
- Saves ~20 gas per iteration

**`abi.encodePacked`** - Concatenates strings
- `baseURI = "ipfs://base/"`
- `tokenId = 5`
- Result: `"ipfs://base/5"`

---

## Whitelist System

```solidity
function setWhitelist(address account, bool status) external onlyOwner
function batchSetWhitelist(address[] calldata accounts, bool status) external onlyOwner
function setWhitelistEnabled(bool enabled) external onlyOwner
```

**Use case:**
1. Enable whitelist for exclusive drop
2. Add VIP addresses
3. VIPs can mint during whitelist period
4. Disable whitelist for public sale

**Flow:**
```javascript
// 1. Enable whitelist
await nft.setWhitelistEnabled(true);

// 2. Add addresses
await nft.batchSetWhitelist(["0x123...", "0x456..."], true);

// 3. Whitelisted users can mint
await nft.connect(user1).mint(user1.address, "ipfs://...");

// 4. Disable for public
await nft.setWhitelistEnabled(false);
```

---

## Royalties (EIP-2981)

```solidity
function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner
```

**What are royalties?**
- Creator earns % of every resale
- E.g., NFT sells for 1 ETH, creator gets 5% (0.05 ETH)

**How it works:**
- `feeNumerator` in basis points
- 100 basis points = 1%
- 500 = 5%, 1000 = 10%

**Marketplaces call:**
```solidity
(address receiver, uint256 amount) = nft.royaltyInfo(tokenId, salePrice);
// Returns: (creatorAddress, 0.05 ether) for 5% of 1 ETH
```

---

## Pausable Functions

```solidity
function pause() external onlyOwner
function unpause() external onlyOwner
```

**When to use:**
- Security vulnerability discovered
- Bug found in contract
- Need to halt operations

**What gets paused:**
- All transfers
- All minting
- Basically all state changes

---

## Required Overrides

```solidity
function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory)
function _update(address to, uint256 tokenId, address auth) internal override whenNotPaused returns (address)
function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage, ERC2981) returns (bool)
```

**Why needed?**

When multiple parent contracts have same function, Solidity needs to know which to use.

`override(Contract1, Contract2)` tells it to combine/override both.

---

## Helper Function: _toString

```solidity
function _toString(uint256 value) internal pure returns (string memory)
```

**Converts number to string:**
- Input: `123`
- Output: `"123"`

**Used for:**
- Building URIs: `"ipfs://base/" + "5"` → `"ipfs://base/5"`

---

## Summary

| Feature | Description |
|---------|-------------|
| **Unique tokens** | Each token ID is one-of-a-kind |
| **Metadata** | Each token has its own URI |
| **Batch mint** | 40% gas savings |
| **Whitelist** | Control who can mint |
| **Royalties** | Earn on every resale |
| **Pausable** | Emergency stop |
| **Burnable** | Destroy tokens |

---

## Common Operations

```javascript
// Deploy
const nft = await ERC721NFT.deploy("Name", "SYM", 10000, royaltyReceiver, 500);

// Mint single
await nft.mint(to, "ipfs://metadata.json");

// Batch mint
await nft.batchMint(to, 10, "ipfs://base/");

// Transfer
await nft.transferFrom(from, to, tokenId);

// Get owner
const owner = await nft.ownerOf(tokenId);

// Get metadata
const uri = await nft.tokenURI(tokenId);

// Check royalty
const [receiver, amount] = await nft.royaltyInfo(tokenId, salePrice);
```
