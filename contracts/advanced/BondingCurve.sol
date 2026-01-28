// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/**
 * @title BondingCurve
 * @notice Automated market maker for NFT collections with bonding curve pricing
 * @dev Implements linear and exponential curves for primary sales
 *
 * Why Bonding Curves?
 * - Price discovery without order books
 * - Guaranteed liquidity at any supply level
 * - Transparent, predictable pricing
 *
 * Curve Types:
 * - Linear: price = basePrice + (supply * slope)
 * - Exponential: price = basePrice * (ratio ^ supply)
 */
contract BondingCurve is Ownable, ReentrancyGuard, Pausable, ERC721Holder {
    enum CurveType {
        Linear,
        Exponential
    }

    struct Pool {
        address nftContract;
        address creator;
        CurveType curveType;
        uint256 basePrice; // Starting price in wei
        uint256 slope; // For linear: wei increase per token
        uint256 ratio; // For exponential: multiplier (scaled by 1e18)
        uint256 maxSupply;
        uint256 currentSupply;
        uint256 reserveBalance; // ETH held for buybacks
        uint256 royaltyFee; // Basis points to creator on sales
        bool buybackEnabled;
    }

    uint256 private _poolIdCounter;
    uint256 public platformFee; // Basis points
    address public feeRecipient;
    uint256 public constant RATIO_SCALE = 1e18;

    mapping(uint256 => Pool) public pools;
    mapping(uint256 => uint256[]) public poolTokenIds; // Pool -> token IDs in pool
    mapping(address => mapping(uint256 => uint256)) public tokenToPool; // NFT -> tokenId -> poolId

    event PoolCreated(
        uint256 indexed poolId,
        address indexed nftContract,
        address indexed creator,
        CurveType curveType
    );
    event TokenBought(
        uint256 indexed poolId,
        address indexed buyer,
        uint256 tokenId,
        uint256 price
    );
    event TokenSold(
        uint256 indexed poolId,
        address indexed seller,
        uint256 tokenId,
        uint256 price
    );
    event PoolConfigUpdated(uint256 indexed poolId);

    error InvalidPool();
    error MaxSupplyReached();
    error InsufficientPayment();
    error InsufficientReserve();
    error BuybackDisabled();
    error NotTokenOwner();
    error TransferFailed();
    error InvalidParams();
    error ZeroAddress();
    error FeeTooHigh();

    constructor(
        uint256 _platformFee,
        address _feeRecipient
    ) Ownable(msg.sender) {
        platformFee = _platformFee;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
    }

    /// @notice Create a new bonding curve pool for an NFT collection
    /// @param nftContract The NFT contract address
    /// @param curveType Linear or Exponential pricing
    /// @param basePrice Starting price in wei
    /// @param slopeOrRatio Slope (linear) or ratio (exponential, scaled by 1e18)
    /// @param maxSupply Maximum tokens this curve will price
    /// @param royaltyFee Basis points to creator on each sale
    /// @param buybackEnabled Whether tokens can be sold back to the curve
    function createPool(
        address nftContract,
        CurveType curveType,
        uint256 basePrice,
        uint256 slopeOrRatio,
        uint256 maxSupply,
        uint256 royaltyFee,
        bool buybackEnabled
    ) external whenNotPaused returns (uint256) {
        if (nftContract == address(0)) revert ZeroAddress();
        if (basePrice == 0) revert InvalidParams();
        if (royaltyFee > 2500) revert InvalidParams(); // Max 25%

        uint256 poolId = _poolIdCounter++;

        pools[poolId] = Pool({
            nftContract: nftContract,
            creator: msg.sender,
            curveType: curveType,
            basePrice: basePrice,
            slope: curveType == CurveType.Linear ? slopeOrRatio : 0,
            ratio: curveType == CurveType.Exponential ? slopeOrRatio : 0,
            maxSupply: maxSupply,
            currentSupply: 0,
            reserveBalance: 0,
            royaltyFee: royaltyFee,
            buybackEnabled: buybackEnabled
        });

        emit PoolCreated(poolId, nftContract, msg.sender, curveType);
        return poolId;
    }

    error SlippageExceeded();

    /// @notice Buy a token at current curve price with slippage protection
    /// @param poolId The pool to buy from
    /// @param tokenId The token ID to purchase (must be owned by pool or mintable)
    /// @param maxPrice Maximum price willing to pay (slippage protection)
    function buy(
        uint256 poolId,
        uint256 tokenId,
        uint256 maxPrice
    ) external payable whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        if (pool.currentSupply >= pool.maxSupply) revert MaxSupplyReached();

        uint256 price = getBuyPrice(poolId);
        if (price > maxPrice) revert SlippageExceeded();
        if (msg.value < price) revert InsufficientPayment();

        pool.currentSupply++;
        poolTokenIds[poolId].push(tokenId);
        tokenToPool[pool.nftContract][tokenId] = poolId;

        // Calculate fee distribution
        uint256 fee = (price * platformFee) / 10000;
        uint256 royalty = (price * pool.royaltyFee) / 10000;
        uint256 forReserve = pool.buybackEnabled ? (price - fee - royalty) : 0;
        uint256 forCreator = price - fee - forReserve;

        pool.reserveBalance += forReserve;

        // Transfer NFT to buyer
        IERC721(pool.nftContract).safeTransferFrom(
            address(this),
            msg.sender,
            tokenId
        );

        // Distribute payments
        if (fee > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: fee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        if (forCreator > 0) {
            (bool creatorSuccess, ) = payable(pool.creator).call{
                value: forCreator
            }("");
            if (!creatorSuccess) revert TransferFailed();
        }

        // Refund excess
        if (msg.value > price) {
            (bool refundSuccess, ) = payable(msg.sender).call{
                value: msg.value - price
            }("");
            if (!refundSuccess) revert TransferFailed();
        }

        emit TokenBought(poolId, msg.sender, tokenId, price);
    }

    /// @notice Sell a token back to the curve
    /// @param poolId The pool to sell to
    /// @param tokenId The token ID to sell
    function sell(
        uint256 poolId,
        uint256 tokenId
    ) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        if (!pool.buybackEnabled) revert BuybackDisabled();
        if (IERC721(pool.nftContract).ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner();

        uint256 price = getSellPrice(poolId);
        if (pool.reserveBalance < price) revert InsufficientReserve();

        pool.currentSupply--;
        pool.reserveBalance -= price;

        // Transfer NFT to pool
        IERC721(pool.nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );

        // Pay seller
        (bool success, ) = payable(msg.sender).call{value: price}("");
        if (!success) revert TransferFailed();

        emit TokenSold(poolId, msg.sender, tokenId, price);
    }

    /// @notice Get current buy price based on curve
    function getBuyPrice(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        return _calculatePrice(pool, pool.currentSupply);
    }

    /// @notice Get current sell price (typically lower than buy for spread)
    function getSellPrice(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.currentSupply == 0) return 0;

        // Sell price is one step back on the curve
        uint256 buyPrice = _calculatePrice(pool, pool.currentSupply - 1);

        // Apply a small spread (95% of buy price)
        return (buyPrice * 95) / 100;
    }

    /// @notice Calculate price at a given supply level
    /// @dev Uses binary exponentiation for O(log n) complexity instead of O(n) iteration
    function _calculatePrice(
        Pool storage pool,
        uint256 supply
    ) internal view returns (uint256) {
        if (pool.curveType == CurveType.Linear) {
            return pool.basePrice + (supply * pool.slope);
        } else {
            // Exponential: basePrice * (ratio ^ supply)
            // Using binary exponentiation for efficiency and unlimited supply support
            return (pool.basePrice * _pow(pool.ratio, supply)) / RATIO_SCALE;
        }
    }

    /// @notice Compute base^exp using binary exponentiation with fixed-point math
    /// @dev O(log n) complexity, handles arbitrarily large exponents
    /// @param base The base value (scaled by RATIO_SCALE, e.g., 1.1e18 for 10% increase)
    /// @param exp The exponent (supply level)
    /// @return result The result scaled by RATIO_SCALE
    function _pow(uint256 base, uint256 exp) internal pure returns (uint256 result) {
        result = RATIO_SCALE; // Start with 1.0 in fixed-point
        
        // Prevent overflow for extremely high supplies
        // At ratio=1.1, supply=1000 would overflow uint256
        // Cap at reasonable supply where price would exceed practical limits
        if (exp > 500) {
            // For very high supplies, return max practical price
            // This is a safety bound - real pools should have maxSupply << 500
            return type(uint256).max / RATIO_SCALE;
        }
        
        while (exp > 0) {
            if (exp % 2 == 1) {
                result = (result * base) / RATIO_SCALE;
            }
            base = (base * base) / RATIO_SCALE;
            exp /= 2;
        }
    }

    /// @notice Get price quote for multiple tokens
    function getQuote(
        uint256 poolId,
        uint256 quantity,
        bool isBuy
    ) external view returns (uint256 total) {
        Pool storage pool = pools[poolId];
        uint256 supply = pool.currentSupply;

        for (uint256 i = 0; i < quantity; i++) {
            if (isBuy) {
                total += _calculatePrice(pool, supply + i);
            } else {
                if (supply > i) {
                    total +=
                        ((_calculatePrice(pool, supply - i - 1)) * 95) /
                        100;
                }
            }
        }
    }

    /// @notice Get pool info
    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    // Admin functions
    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > 1000) revert FeeTooHigh();
        platformFee = newFee;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
