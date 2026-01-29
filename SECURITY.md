# Security

## Overview

This NFT marketplace project implements multiple security improvements based on professional audit feedback. However, **this is still a learning/educational project and has NOT been audited by a professional security firm.**

## ⚠️ WARNING

**DO NOT deploy these contracts to mainnet with real funds without:**
1. Professional security audit
2. Extensive testnet testing with real users
3. Bug bounty program
4. Formal verification of critical invariants
5. Insurance/safety mechanisms

## Security Improvements (January 2026)

### Critical Bugs Fixed

#### 1. ✅ FractionalVault Mapping Collision
**Issue:** Used `mapping(address => uint256)` keyed only by NFT contract address, allowing only one tokenId per contract to be vaulted.

**Fix:** Changed to `mapping(bytes32 => uint256)` with `keccak256(abi.encode(nftContract, tokenId))` as key.

**Impact:** High - Would have caused vault collisions for multi-token collections.

#### 2. ✅ BondingCurve NFT Ownership Verification
**Issue:** No verification that contract actually holds NFT before transferring to buyer.

**Fix:** Added ownership check before transfer:
```solidity
if (IERC721(pool.nftContract).ownerOf(tokenId) != address(this)) {
    revert NotTokenOwner();
}
```

**Impact:** High - Pool creator could setup fraudulent pools.

#### 3. ✅ Royalty Cap
**Issue:** Malicious NFT contracts could set 100% royalty and drain buyers.

**Fix:** Cap royalties at 10% in all sale executions:
```solidity
royaltyAmount = amount > (price / 10) ? (price / 10) : amount;
```

**Impact:** Medium - Prevents malicious NFT draining attacks.

#### 4. ✅ UUPS Upgrade Timelock Enforcement
**Issue:** Upgrade timelock was declared but not enforced in `_authorizeUpgrade`.

**Fix:** Added timelock check:
```solidity
if (block.timestamp < scheduledUpgrades[newImplementation]) {
    revert UpgradeTooEarly();
}
```

**Impact:** Medium - Allows community to review upgrades before execution.

#### 5. ✅ VickreyAuction Unrevealed Deposit Reclaim
**Issue:** Bidders who commit but don't reveal have stuck funds.

**Fix:** Implemented `reclaimUnrevealedDeposit()` function callable after auction ends.

**Impact:** Medium - Prevents accidental fund lockup.

#### 6. ✅ Slippage Protection on Sell
**Issue:** BondingCurve.sell() had no slippage protection, allowing sandwich attacks.

**Fix:** Added `minPrice` parameter:
```solidity
function sell(uint256 poolId, uint256 tokenId, uint256 minPrice) external
```

**Impact:** Medium - Protects sellers from MEV attacks.

#### 7. ✅ Batch Operation Bounds
**Issue:** Unbounded loops in batch operations could hit gas limits.

**Fix:** Added maximum of 100 items per batch:
```solidity
if (quantity == 0 || quantity > 100) revert InvalidQuantity();
```

**Impact:** Low - Prevents DOS via gas exhaustion.

## Invariant Tests

Critical financial invariants are now tested in Foundry:

### FractionalVault
- ✅ Share supply equals totalShares before buyout
- ✅ NFT custody matches vault state
- ✅ Buyout proceeds distribution is accurate

### BondingCurve
- ✅ Reserve balance ≥ total sell liability
- ✅ Price monotonicity (never decreases with supply)
- ✅ Buy-then-sell always results in loss (spread exists)

### Marketplace
- ✅ State transitions are irreversible (Active → Sold/Cancelled only)
- ✅ NFT custody matches listing state
- ✅ Pending withdrawals ≤ contract balance

## Additional Fixes (January 2026)

#### 8. ✅ MarketplaceV2 Royalty Cap
**Issue:** MarketplaceV2 was missing the 10% royalty cap present in V1.

**Fix:** Added royalty cap to both `_executeSaleETH` and `_executeSaleERC20`:
```solidity
royaltyAmount = amount > (price / 10) ? (price / 10) : amount;
```

**Impact:** High - Prevents malicious NFT contracts from draining buyers.

#### 9. ✅ Royalty Recipient Validation
**Issue:** Could send royalties to zero address if NFT returns invalid data.

**Fix:** Skip royalty if recipient is zero address:
```solidity
if (royaltyRecipient == address(0)) {
    royaltyAmount = 0;
}
```

**Impact:** Medium - Prevents fund loss to zero address.

#### 10. ✅ FractionalVault Per-Vault Balance Tracking
**Issue:** `withdrawDust()` used `address(this).balance`, allowing cross-vault fund theft.

**Fix:** Added `vaultBalances` mapping to track ETH per vault:
```solidity
mapping(uint256 => uint256) public vaultBalances;
```

**Impact:** High - Prevents curators from stealing other vaults' funds.

#### 11. ✅ MetaTransactionHandler Gas Limit
**Issue:** No gas limit on meta-transaction execution, enabling relayer griefing.

**Fix:** Added 500k gas limit:
```solidity
uint256 gasLimit = gasleft() > 550000 ? 500000 : gasleft() - 50000;
(bool success, bytes memory returnData) = metaTx.to.call{
    value: metaTx.value,
    gas: gasLimit
}(metaTx.data);
```

**Impact:** Medium - Prevents relayer griefing attacks.

#### 12. ✅ Protocol Registry for Emergency Pause
**Issue:** No way to pause entire protocol atomically.

**Fix:** Added `ProtocolRegistry.sol` contract with emergency pause functionality.

**Impact:** Medium - Enables coordinated emergency response.

## Remaining Known Issues

### Medium Priority
1. **ERC1155 buyout complexity** - FractionalVault only supports ERC721
2. **Limited upgrade patterns** - Only MarketplaceV2 is upgradeable

### Low Priority
1. **Gas optimization** - Not production-optimized
2. **Storage layout** - Not formally documented for upgrades

## Security Best Practices Implemented

- ✅ ReentrancyGuard on all external value transfers
- ✅ Pull payment pattern to prevent DOS
- ✅ CEI (Checks-Effects-Interactions) pattern
- ✅ Custom errors for gas efficiency
- ✅ Flash loan protection (same-block restrictions)
- ✅ EIP-712 typed signatures for meta-transactions
- ✅ Pausable contracts for emergency stops
- ✅ Access control via OpenZeppelin patterns

## Testing Strategy

### Unit Tests (Hardhat)
- 12 test files covering happy paths and error cases
- ~90% branch coverage
- Gas reporting enabled

### Invariant Tests (Foundry)
- 3 critical contracts tested
- Property-based testing for financial logic
- Continuous fuzzing of state transitions

### Static Analysis (Slither)
- Automated in GitHub Actions
- High/medium findings must be resolved
- Configured to ignore known false positives

## Disclosure Policy

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email: [your-email@example.com] (update this)
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and coordinate disclosure timeline.

## Audit Status

- ❌ No professional audit completed
- ✅ Internal review and fixes applied
- ⏳ Testnet deployment pending
- ⏳ Public bug bounty not yet launched

## Further Reading

- [OpenZeppelin Security](https://docs.openzeppelin.com/contracts/4.x/security)
- [Consensys Smart Contract Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [Trail of Bits Building Secure Contracts](https://github.com/crytic/building-secure-contracts)
- [Paradigm's Guide to Invariant Testing](https://www.paradigm.xyz/2023/04/invariant-testing)

## License

ISC - See LICENSE file for details.
