// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IAuction
 * @notice Unified interface for all auction types
 * @dev Enables polymorphic auction handling and router patterns
 */
interface IAuction {
    enum AuctionStatus {
        Active,
        Ended,
        Cancelled
    }

    struct AuctionInfo {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        uint256 startTime;
        uint256 endTime;
        uint256 highestBid;
        address highestBidder;
        AuctionStatus status;
    }

    /// @notice Get auction details
    /// @param auctionId The auction ID
    /// @return Auction information
    function getAuction(
        uint256 auctionId
    ) external view returns (AuctionInfo memory);

    /// @notice Check if auction is active
    /// @param auctionId The auction ID
    /// @return True if auction is active and not expired
    function isActive(uint256 auctionId) external view returns (bool);

    /// @notice End an auction and settle
    /// @param auctionId The auction ID
    function endAuction(uint256 auctionId) external;

    /// @notice Cancel an auction (seller only, if no bids)
    /// @param auctionId The auction ID
    function cancelAuction(uint256 auctionId) external;

    /// @notice Get total number of auctions
    function getTotalAuctions() external view returns (uint256);

    // Events
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nftContract
    );
    event AuctionEnded(
        uint256 indexed auctionId,
        address winner,
        uint256 amount
    );
    event AuctionCancelled(uint256 indexed auctionId);
}

/**
 * @title IEnglishAuction
 * @notice Interface for English (ascending price) auctions
 */
interface IEnglishAuction is IAuction {
    /// @notice Place a bid
    /// @param auctionId The auction ID
    function placeBid(uint256 auctionId) external payable;

    /// @notice Get minimum next bid
    /// @param auctionId The auction ID
    /// @return Minimum bid amount
    function getMinBid(uint256 auctionId) external view returns (uint256);

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount
    );
}

/**
 * @title IDutchAuction
 * @notice Interface for Dutch (descending price) auctions
 */
interface IDutchAuction is IAuction {
    /// @notice Get current price
    /// @param auctionId The auction ID
    /// @return Current price based on time elapsed
    function getCurrentPrice(uint256 auctionId) external view returns (uint256);

    /// @notice Buy at current price
    /// @param auctionId The auction ID
    function buy(uint256 auctionId) external payable;
}

/**
 * @title IVickreyAuction
 * @notice Interface for sealed-bid second-price auctions
 */
interface IVickreyAuction is IAuction {
    enum Phase {
        Commit,
        Reveal,
        Ended
    }

    /// @notice Get current auction phase
    /// @param auctionId The auction ID
    /// @return Current phase
    function getPhase(uint256 auctionId) external view returns (Phase);

    /// @notice Submit sealed bid commitment
    /// @param auctionId The auction ID
    /// @param commitHash Hash of bid + salt
    function commitBid(uint256 auctionId, bytes32 commitHash) external payable;

    /// @notice Reveal sealed bid
    /// @param auctionId The auction ID
    /// @param bid Actual bid amount
    /// @param salt Salt used in commitment
    function revealBid(uint256 auctionId, uint256 bid, bytes32 salt) external;

    /// @notice Settle auction after reveal phase
    /// @param auctionId The auction ID
    function settle(uint256 auctionId) external;

    event BidCommitted(uint256 indexed auctionId, address indexed bidder);
    event BidRevealed(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bid
    );
}
