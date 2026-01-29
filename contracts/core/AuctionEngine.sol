// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract AuctionEngine is
    Ownable,
    ReentrancyGuard,
    Pausable,
    ERC721Holder,
    ERC1155Holder
{
    enum AuctionType {
        English,
        Dutch
    }
    enum TokenType {
        ERC721,
        ERC1155
    }
    enum AuctionStatus {
        Active,
        Ended,
        Cancelled
    }

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        TokenType tokenType;
        AuctionType auctionType;
        AuctionStatus status;
        uint256 startPrice;
        uint256 reservePrice;
        uint256 endPrice;
        uint256 startTime;
        uint256 endTime;
        address highestBidder;
        uint256 highestBid;
    }

    uint256 private _auctionIdCounter;
    uint256 public platformFee;
    address public feeRecipient;
    uint256 public antiSnipingDuration;
    uint256 public minBidIncrementBps;

    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public pendingReturns; // Outbid refunds and seller proceeds
    mapping(uint256 => uint256) public auctionCreatedBlock; // Auction-level flash loan protection

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        AuctionType auctionType
    );
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount
    );
    event AuctionExtended(uint256 indexed auctionId, uint256 newEndTime);
    event AuctionEnded(
        uint256 indexed auctionId,
        address winner,
        uint256 amount
    );
    event AuctionCancelled(uint256 indexed auctionId);
    event PlatformFeeUpdated(uint256 newFee);
    event AntiSnipingDurationUpdated(uint256 newDuration);
    event MinBidIncrementUpdated(uint256 newBps);
    event FundsWithdrawn(address indexed recipient, uint256 amount);

    error AuctionNotActive();
    error AuctionStillActive();
    error AuctionExpired();
    error BidTooLow();
    error NotSeller();
    error InvalidDuration();
    error InvalidPrice();
    error NoPendingReturns();
    error TransferFailed();
    error ZeroAddress();
    error HasBids();
    error InvalidParams();
    error FeeTooHigh();
    error SameBlockBid();

    /// @notice Prevents same-block bidding on newly created auctions
    modifier noSameBlockBid(uint256 auctionId) {
        if (block.number == auctionCreatedBlock[auctionId])
            revert SameBlockBid();
        _;
    }

    constructor(
        uint256 _platformFee,
        address _feeRecipient
    ) Ownable(msg.sender) {
        platformFee = _platformFee;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
        antiSnipingDuration = 10 minutes;
        minBidIncrementBps = 500; // 5%
    }

    function createEnglishAuction(
        address nftContract,
        uint256 tokenId,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 duration
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (duration < 1 hours) revert InvalidDuration();
        if (startPrice == 0) revert InvalidPrice();

        IERC721(nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );

        uint256 auctionId = _auctionIdCounter++;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: 1,
            tokenType: TokenType.ERC721,
            auctionType: AuctionType.English,
            status: AuctionStatus.Active,
            startPrice: startPrice,
            reservePrice: reservePrice,
            endPrice: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            highestBidder: address(0),
            highestBid: 0
        });

        auctionCreatedBlock[auctionId] = block.number;

        emit AuctionCreated(auctionId, msg.sender, AuctionType.English);
        return auctionId;
    }

    function createDutchAuction(
        address nftContract,
        uint256 tokenId,
        uint256 startPrice,
        uint256 endPrice,
        uint256 duration
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (duration < 1 hours) revert InvalidDuration();
        if (startPrice <= endPrice) revert InvalidPrice();

        IERC721(nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );

        uint256 auctionId = _auctionIdCounter++;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: 1,
            tokenType: TokenType.ERC721,
            auctionType: AuctionType.Dutch,
            status: AuctionStatus.Active,
            startPrice: startPrice,
            reservePrice: 0,
            endPrice: endPrice,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            highestBidder: address(0),
            highestBid: 0
        });

        auctionCreatedBlock[auctionId] = block.number;

        emit AuctionCreated(auctionId, msg.sender, AuctionType.Dutch);
        return auctionId;
    }

    function createERC1155Auction(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 duration
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (duration < 1 hours) revert InvalidDuration();
        if (startPrice == 0 || amount == 0) revert InvalidParams();

        IERC1155(nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId,
            amount,
            ""
        );

        uint256 auctionId = _auctionIdCounter++;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: amount,
            tokenType: TokenType.ERC1155,
            auctionType: AuctionType.English,
            status: AuctionStatus.Active,
            startPrice: startPrice,
            reservePrice: reservePrice,
            endPrice: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            highestBidder: address(0),
            highestBid: 0
        });

        auctionCreatedBlock[auctionId] = block.number;

        emit AuctionCreated(auctionId, msg.sender, AuctionType.English);
        return auctionId;
    }

    function placeBid(
        uint256 auctionId
    ) external payable whenNotPaused nonReentrant noSameBlockBid(auctionId) {
        Auction storage auction = auctions[auctionId];

        if (auction.status != AuctionStatus.Active) revert AuctionNotActive();
        if (block.timestamp >= auction.endTime) revert AuctionExpired();

        if (auction.auctionType == AuctionType.Dutch) {
            _handleDutchBid(auctionId, auction);
        } else {
            _handleEnglishBid(auctionId, auction);
        }
    }

    function _handleEnglishBid(
        uint256 auctionId,
        Auction storage auction
    ) internal {
        uint256 minBid;
        if (auction.highestBid == 0) {
            minBid = auction.startPrice;
        } else {
            minBid =
                auction.highestBid +
                ((auction.highestBid * minBidIncrementBps) / 10000);
        }

        if (msg.value < minBid) revert BidTooLow();

        if (auction.highestBidder != address(0)) {
            pendingReturns[auction.highestBidder] += auction.highestBid;
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;

        // Anti-sniping
        if (block.timestamp + antiSnipingDuration > auction.endTime) {
            auction.endTime = block.timestamp + antiSnipingDuration;
            emit AuctionExtended(auctionId, auction.endTime);
        }

        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    function _handleDutchBid(
        uint256 auctionId,
        Auction storage auction
    ) internal {
        uint256 currentPrice = getDutchPrice(auctionId);
        if (msg.value < currentPrice) revert BidTooLow();

        auction.status = AuctionStatus.Ended;
        auction.highestBidder = msg.sender;
        auction.highestBid = currentPrice;

        _transferNFT(auction, msg.sender);
        _distributePayment(auction, currentPrice);

        // Refund excess
        if (msg.value > currentPrice) {
            (bool success, ) = payable(msg.sender).call{
                value: msg.value - currentPrice
            }("");
            if (!success) revert TransferFailed();
        }

        emit AuctionEnded(auctionId, msg.sender, currentPrice);
    }

    function getDutchPrice(uint256 auctionId) public view returns (uint256) {
        Auction storage a = auctions[auctionId];

        if (block.timestamp >= a.endTime) return a.endPrice;

        uint256 elapsed = block.timestamp - a.startTime;
        uint256 duration = a.endTime - a.startTime;
        uint256 drop = a.startPrice - a.endPrice;

        return a.startPrice - ((drop * elapsed) / duration);
    }

    function endAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];

        if (auction.status != AuctionStatus.Active) revert AuctionNotActive();
        if (block.timestamp < auction.endTime) revert AuctionStillActive();

        auction.status = AuctionStatus.Ended;

        bool hasWinner = auction.highestBidder != address(0) &&
            auction.highestBid >= auction.reservePrice;

        if (hasWinner) {
            _transferNFT(auction, auction.highestBidder);
            _distributePayment(auction, auction.highestBid);
            emit AuctionEnded(
                auctionId,
                auction.highestBidder,
                auction.highestBid
            );
        } else {
            _transferNFT(auction, auction.seller);
            if (auction.highestBidder != address(0)) {
                pendingReturns[auction.highestBidder] += auction.highestBid;
            }
            emit AuctionEnded(auctionId, address(0), 0);
        }
    }

    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];

        if (auction.seller != msg.sender) revert NotSeller();
        if (auction.status != AuctionStatus.Active) revert AuctionNotActive();
        if (auction.highestBidder != address(0)) revert HasBids();

        auction.status = AuctionStatus.Cancelled;
        _transferNFT(auction, auction.seller);

        emit AuctionCancelled(auctionId);
    }

    function withdrawPendingReturns() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NoPendingReturns();

        pendingReturns[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FundsWithdrawn(msg.sender, amount);
    }

    function _transferNFT(Auction storage auction, address to) internal {
        if (auction.tokenType == TokenType.ERC721) {
            IERC721(auction.nftContract).safeTransferFrom(
                address(this),
                to,
                auction.tokenId
            );
        } else {
            IERC1155(auction.nftContract).safeTransferFrom(
                address(this),
                to,
                auction.tokenId,
                auction.amount,
                ""
            );
        }
    }

    function _distributePayment(
        Auction storage auction,
        uint256 price
    ) internal {
        uint256 platformAmount = (price * platformFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient = address(0);

        try
            IERC2981(auction.nftContract).royaltyInfo(auction.tokenId, price)
        returns (address receiver, uint256 amount) {
            royaltyRecipient = receiver;
            // Cap royalty at 10% to prevent malicious NFT contracts
            royaltyAmount = amount > (price / 10) ? (price / 10) : amount;
        } catch {}
        uint256 sellerAmount = price - platformAmount - royaltyAmount;

        // Platform fee: direct transfer (trusted recipient)
        if (platformAmount > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{
                value: platformAmount
            }("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Royalty and seller: pull-pattern to prevent DoS
        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            pendingReturns[royaltyRecipient] += royaltyAmount;
        }

        pendingReturns[auction.seller] += sellerAmount;
    }

    function getAuction(
        uint256 auctionId
    ) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    function getTotalAuctions() external view returns (uint256) {
        return _auctionIdCounter;
    }

    function isActive(uint256 auctionId) external view returns (bool) {
        Auction storage a = auctions[auctionId];
        return a.status == AuctionStatus.Active && block.timestamp < a.endTime;
    }

    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > 1000) revert FeeTooHigh();
        platformFee = newFee;
        emit PlatformFeeUpdated(newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function setAntiSnipingDuration(uint256 duration) external onlyOwner {
        antiSnipingDuration = duration;
        emit AntiSnipingDurationUpdated(duration);
    }

    function setMinBidIncrement(uint256 bps) external onlyOwner {
        minBidIncrementBps = bps;
        emit MinBidIncrementUpdated(bps);
    }

    function pause() external onlyOwner {
        _pause();
    }
    function unpause() external onlyOwner {
        _unpause();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
