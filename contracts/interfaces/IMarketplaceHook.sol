// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IMarketplaceHook
 * @notice Hook interface for extending marketplace functionality (Uniswap v4 style)
 * @dev Inspired by Uniswap v4 hooks - allows custom logic at key execution points
 *
 * Use cases:
 * - Custom fee tiers per collection
 * - Dynamic royalty enforcement
 * - Whitelist/allowlist checks
 * - Anti-bot protection
 * - Analytics/logging
 * - Cross-protocol integrations
 */
interface IMarketplaceHook {
    /// @notice Called before a listing is created
    /// @param seller The address creating the listing
    /// @param nftContract The NFT contract address
    /// @param tokenId The token ID being listed
    /// @param price The listing price
    /// @return proceed Whether to proceed with the listing
    function beforeList(
        address seller,
        address nftContract,
        uint256 tokenId,
        uint256 price
    ) external returns (bool proceed);

    /// @notice Called after a listing is created
    /// @param listingId The ID of the created listing
    /// @param seller The address that created the listing
    function afterList(uint256 listingId, address seller) external;

    /// @notice Called before a sale is executed
    /// @param listingId The listing being purchased
    /// @param buyer The address attempting to buy
    /// @param price The sale price
    /// @return proceed Whether to proceed with the sale
    /// @return feeOverride Optional fee override (0 = use default)
    function beforeSale(
        uint256 listingId,
        address buyer,
        uint256 price
    ) external returns (bool proceed, uint256 feeOverride);

    /// @notice Called after a sale is completed
    /// @param listingId The listing that was sold
    /// @param seller The seller address
    /// @param buyer The buyer address
    /// @param price The final sale price
    function afterSale(
        uint256 listingId,
        address seller,
        address buyer,
        uint256 price
    ) external;

    /// @notice Called before an auction bid is placed
    /// @param auctionId The auction being bid on
    /// @param bidder The address placing the bid
    /// @param amount The bid amount
    /// @return proceed Whether to proceed with the bid
    function beforeBid(
        uint256 auctionId,
        address bidder,
        uint256 amount
    ) external returns (bool proceed);

    /// @notice Called after an auction is settled
    /// @param auctionId The auction that was settled
    /// @param winner The winning bidder
    /// @param amount The winning amount
    function afterAuctionSettled(
        uint256 auctionId,
        address winner,
        uint256 amount
    ) external;
}

/**
 * @title BaseHook
 * @notice Base implementation of IMarketplaceHook with default pass-through behavior
 * @dev Inherit from this and override only the hooks you need
 */
abstract contract BaseHook is IMarketplaceHook {
    function beforeList(
        address,
        address,
        uint256,
        uint256
    ) external virtual returns (bool) {
        return true; // Default: allow
    }

    function afterList(uint256, address) external virtual {}

    function beforeSale(
        uint256,
        address,
        uint256
    ) external virtual returns (bool, uint256) {
        return (true, 0); // Default: allow, no fee override
    }

    function afterSale(uint256, address, address, uint256) external virtual {}

    function beforeBid(
        uint256,
        address,
        uint256
    ) external virtual returns (bool) {
        return true;
    }

    function afterAuctionSettled(uint256, address, uint256) external virtual {}
}

/**
 * @title WhitelistHook
 * @notice Example hook that restricts buying to whitelisted addresses
 */
contract WhitelistHook is BaseHook {
    mapping(address => bool) public whitelist;
    address public owner;

    error NotOwner();
    error NotWhitelisted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setWhitelisted(address account, bool status) external onlyOwner {
        whitelist[account] = status;
    }

    function beforeSale(
        uint256,
        address buyer,
        uint256
    ) external view override returns (bool, uint256) {
        if (!whitelist[buyer]) revert NotWhitelisted();
        return (true, 0);
    }
}

/**
 * @title DynamicFeeHook
 * @notice Example hook that applies collection-specific fee tiers
 */
contract DynamicFeeHook is BaseHook {
    mapping(address => uint256) public collectionFees; // nftContract => fee in bps
    address public owner;
    uint256 public defaultFee;

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 _defaultFee) {
        owner = msg.sender;
        defaultFee = _defaultFee;
    }

    function setCollectionFee(
        address nftContract,
        uint256 fee
    ) external onlyOwner {
        collectionFees[nftContract] = fee;
    }

    function beforeSale(
        uint256,
        address,
        uint256
    ) external view override returns (bool, uint256) {
        // Return custom fee (would need listing info to get nftContract)
        // This is a simplified example
        return (true, defaultFee);
    }
}

/**
 * @title AntiBotHook
 * @notice Example hook that prevents rapid sequential purchases
 */
contract AntiBotHook is BaseHook {
    mapping(address => uint256) public lastPurchaseBlock;
    uint256 public cooldownBlocks;
    address public owner;

    error NotOwner();
    error CooldownActive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 _cooldownBlocks) {
        owner = msg.sender;
        cooldownBlocks = _cooldownBlocks;
    }

    function setCooldown(uint256 blocks) external onlyOwner {
        cooldownBlocks = blocks;
    }

    function beforeSale(
        uint256,
        address buyer,
        uint256
    ) external override returns (bool, uint256) {
        if (block.number < lastPurchaseBlock[buyer] + cooldownBlocks) {
            revert CooldownActive();
        }
        lastPurchaseBlock[buyer] = block.number;
        return (true, 0);
    }
}
