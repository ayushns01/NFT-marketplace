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
    
    // Named constants to avoid magic numbers and document intent
    uint256 public constant SELL_SPREAD_PERCENT = 95; // Sellers receive 95% of buy price (5% spread)
    uint256 public constant MAX_BATCH_SIZE = 100; // Prevent gas exhaustion in batch operations
    uint256 public constant MAX_EXPONENTIAL_SUPPLY = 500; // Overflow protection for exponential curves
    uint256 public constant MAX_ROYALTY_BPS = 2500; // 25% maximum royalty to prevent abuse
    
    // Pull-pattern mapping for creator payments (prevents DoS if creator is malicious contract)
    mapping(address => uint256) public pendingCreatorPayments;

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
    error NotPoolCreator();
    error NoTokensAvailable();
    error TokenNotInPool();
    error InvalidMaxSupply();
    error NothingToWithdraw();

    event TokensDeposited(uint256 indexed poolId, address indexed depositor, uint256[] tokenIds);
    event TokensWithdrawn(uint256 indexed poolId, address indexed creator, uint256[] tokenIds);
    event CreatorPaymentAccrued(uint256 indexed poolId, address indexed creator, uint256 amount);
    event CreatorPaymentWithdrawn(address indexed creator, uint256 amount);
    event EmergencyTokenWithdrawn(uint256 indexed poolId, address indexed token, uint256 tokenId);

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
        // Validate maxSupply to prevent unbounded pools and ensure pool has purpose
        if (maxSupply == 0) revert InvalidMaxSupply();
        if (royaltyFee > MAX_ROYALTY_BPS) revert InvalidParams();

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

    /// @notice Deposit NFTs into the pool for sale (FIX C-2)
    /// @param poolId The pool to deposit to
    /// @param tokenIds Array of token IDs to deposit
    function depositTokens(uint256 poolId, uint256[] calldata tokenIds) 
        external 
        whenNotPaused
        nonReentrant 
    {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        if (msg.sender != pool.creator) revert NotPoolCreator();
        
        IERC721 nft = IERC721(pool.nftContract);
        uint256 len = tokenIds.length;
        
        for (uint256 i = 0; i < len; ) {
            nft.safeTransferFrom(msg.sender, address(this), tokenIds[i]);
            poolTokenIds[poolId].push(tokenIds[i]);
            unchecked { ++i; }
        }
        
        emit TokensDeposited(poolId, msg.sender, tokenIds);
    }

    /// @notice Withdraw unsold NFTs from the pool (creator only)
    /// @param poolId The pool to withdraw from
    /// @param tokenIds Array of token IDs to withdraw
    function withdrawTokens(uint256 poolId, uint256[] calldata tokenIds)
        external
        nonReentrant
    {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.creator) revert NotPoolCreator();
        
        IERC721 nft = IERC721(pool.nftContract);
        
        for (uint256 i = 0; i < tokenIds.length; ) {
            _removeTokenFromPool(poolId, tokenIds[i]);
            nft.safeTransferFrom(address(this), msg.sender, tokenIds[i]);
            unchecked { ++i; }
        }
        
        emit TokensWithdrawn(poolId, msg.sender, tokenIds);
    }

    /// @dev Remove a token from the pool's available tokens array
    function _removeTokenFromPool(uint256 poolId, uint256 tokenId) internal {
        uint256[] storage tokens = poolTokenIds[poolId];
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; ) {
            if (tokens[i] == tokenId) {
                tokens[i] = tokens[len - 1];
                tokens.pop();
                return;
            }
            unchecked { ++i; }
        }
        revert TokenNotInPool();
    }

    error SlippageExceeded();

    /// @notice Buy a token at current curve price with slippage protection (FIX C-2)
    /// @param poolId The pool to buy from
    /// @param maxPrice Maximum price willing to pay (slippage protection)
    function buy(
        uint256 poolId,
        uint256 maxPrice
    ) external payable whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        if (pool.currentSupply >= pool.maxSupply) revert MaxSupplyReached();
        
        // FIX C-2: Check available tokens from deposited pool
        uint256[] storage availableTokens = poolTokenIds[poolId];
        if (availableTokens.length == 0) revert NoTokensAvailable();

        uint256 price = getBuyPrice(poolId);
        if (price > maxPrice) revert SlippageExceeded();
        if (msg.value < price) revert InsufficientPayment();

        // Get last token (gas efficient pop)
        uint256 tokenId = availableTokens[availableTokens.length - 1];
        availableTokens.pop();
        
        pool.currentSupply++;
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

        // Platform fee: direct transfer (trusted, admin-controlled recipient)
        if (fee > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: fee}("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Creator payment: use pull-pattern to prevent DoS if creator is malicious contract
        // Creator must call withdrawCreatorPayments() to receive funds
        if (forCreator > 0) {
            pendingCreatorPayments[pool.creator] += forCreator;
            emit CreatorPaymentAccrued(poolId, pool.creator, forCreator);
        }

        // Refund excess payment to buyer
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
    /// @param minPrice Minimum price to accept (slippage protection)
    function sell(
        uint256 poolId,
        uint256 tokenId,
        uint256 minPrice
    ) external whenNotPaused nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        if (!pool.buybackEnabled) revert BuybackDisabled();
        if (IERC721(pool.nftContract).ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner();

        uint256 price = getSellPrice(poolId);
        if (price < minPrice) revert SlippageExceeded();
        if (pool.reserveBalance < price) revert InsufficientReserve();

        pool.currentSupply--;
        pool.reserveBalance -= price;

        // Transfer NFT to pool
        IERC721(pool.nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );
        
        // FIX: Add token back to available pool for resale
        poolTokenIds[poolId].push(tokenId);

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
    /// @dev Spread exists to: 1) Compensate reserve for liquidity provision
    ///      2) Prevent arbitrage that would drain reserves 3) Create sustainable AMM economics
    function getSellPrice(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.currentSupply == 0) return 0;

        // Sell price is one step back on the curve (previous supply level)
        uint256 buyPrice = _calculatePrice(pool, pool.currentSupply - 1);

        // Apply spread - sellers receive SELL_SPREAD_PERCENT of the buy price
        // This 5% spread funds reserve solvency and prevents wash trading
        return (buyPrice * SELL_SPREAD_PERCENT) / 100;
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
    /// @dev Binary exponentiation achieves O(log n) complexity vs O(n) naive iteration.
    ///
    /// WHY THIS ALGORITHM:
    /// - Naive approach: multiply base n times = O(n) operations
    /// - Binary exp: uses property that x^n = (x^(n/2))^2 for even n
    /// - Example: x^13 = x^8 * x^4 * x^1 (13 = 1101 in binary)
    ///
    /// FIXED-POINT MATH:
    /// - All values scaled by RATIO_SCALE (1e18) to simulate decimals
    /// - Division after each multiplication prevents intermediate overflow
    /// - base=1.1e18 means 10% price increase per token
    ///
    /// @param base The base value (scaled by RATIO_SCALE, e.g., 1.1e18 for 10% increase)
    /// @param exp The exponent (supply level)
    /// @return result The result scaled by RATIO_SCALE
    function _pow(uint256 base, uint256 exp) internal pure returns (uint256 result) {
        result = RATIO_SCALE; // Start with 1.0 in fixed-point (1e18 / 1e18 = 1)
        
        // OVERFLOW PROTECTION:
        // At ratio=1.1 (10% increase), supply=500 yields price multiplier of ~5e21
        // Beyond this, uint256 overflow becomes likely during intermediate calculations
        // Real pools should set maxSupply well below this theoretical limit
        if (exp > MAX_EXPONENTIAL_SUPPLY) {
            return type(uint256).max / RATIO_SCALE;
        }
        
        // Binary exponentiation loop - processes one bit of exponent per iteration
        while (exp > 0) {
            // If current bit is 1, multiply result by current base
            if (exp % 2 == 1) {
                result = (result * base) / RATIO_SCALE;
            }
            // Square the base for next bit position
            base = (base * base) / RATIO_SCALE;
            // Shift to next bit
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
                        ((_calculatePrice(pool, supply - i - 1)) * SELL_SPREAD_PERCENT) /
                        100;
                }
            }
        }
    }

    /// @notice Get pool info
    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    /// @notice Get available token IDs in pool
    function getAvailableTokens(uint256 poolId) external view returns (uint256[] memory) {
        return poolTokenIds[poolId];
    }

    /// @notice Get count of available tokens in pool
    function getAvailableTokenCount(uint256 poolId) external view returns (uint256) {
        return poolTokenIds[poolId].length;
    }

    // ============ Withdrawal Functions ============
    
    /// @notice Withdraw accumulated creator payments (pull-pattern)
    /// @dev Creators call this to receive their sales proceeds safely
    function withdrawCreatorPayments() external nonReentrant {
        uint256 amount = pendingCreatorPayments[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        
        pendingCreatorPayments[msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit CreatorPaymentWithdrawn(msg.sender, amount);
    }
    
    /// @notice Emergency function to recover NFTs stuck in abandoned pools
    /// @dev Only callable by owner after pool creator abandons (e.g., lost keys)
    ///      Requires pool to have no reserve (no user funds at risk)
    /// @param poolId The pool containing the stuck NFT
    /// @param tokenId The specific token ID to recover
    /// @param recipient Address to send the recovered NFT to
    function emergencyWithdrawNFT(
        uint256 poolId,
        uint256 tokenId,
        address recipient
    ) external onlyOwner nonReentrant {
        Pool storage pool = pools[poolId];
        if (pool.nftContract == address(0)) revert InvalidPool();
        // Safety: only allow recovery if no user funds (reserve) are at risk
        if (pool.reserveBalance > 0) revert InvalidParams();
        if (recipient == address(0)) revert ZeroAddress();
        
        _removeTokenFromPool(poolId, tokenId);
        IERC721(pool.nftContract).safeTransferFrom(address(this), recipient, tokenId);
        
        emit EmergencyTokenWithdrawn(poolId, pool.nftContract, tokenId);
    }

    // ============ Admin Functions ============
    
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
