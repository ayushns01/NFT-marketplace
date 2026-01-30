// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VickreyAuction
 * @notice Sealed-bid second-price auction using commit-reveal scheme
 * @dev Demonstrates cryptographic primitives and advanced auction theory
 *
 * How it works:
 * 1. COMMIT PHASE: Bidders submit hash(bid + salt) without revealing amount
 * 2. REVEAL PHASE: Bidders reveal actual bid and salt
 * 3. SETTLEMENT: Winner pays second-highest price (Vickrey mechanism)
 *
 * Why Vickrey? Incentivizes truthful bidding - optimal strategy is to bid true value
 */
contract VickreyAuction is Ownable, ReentrancyGuard, Pausable, ERC721Holder {
    enum AuctionPhase {
        NotStarted,
        Commit,
        Reveal,
        Ended
    }

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 reservePrice; // Minimum acceptable price
        uint256 commitDeadline; // End of commit phase
        uint256 revealDeadline; // End of reveal phase
        address highestBidder;
        uint256 highestBid;
        uint256 secondHighestBid;
        bool settled;
    }

    struct Commitment {
        bytes32 hash; // keccak256(abi.encodePacked(bid, salt))
        uint256 deposit; // ETH deposited as collateral
        bool revealed;
    }

    uint256 private _auctionIdCounter;
    uint256 public platformFee; // Basis points (e.g., 250 = 2.5%)
    address public feeRecipient;
    uint256 public minCommitDuration;
    uint256 public minRevealDuration;

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => mapping(address => Commitment)) public commitments;
    mapping(address => uint256) public pendingWithdrawals;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 reservePrice
    );
    event BidCommitted(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 deposit
    );
    event BidRevealed(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bid
    );
    event AuctionSettled(
        uint256 indexed auctionId,
        address winner,
        uint256 winningBid,
        uint256 paidPrice // Second-highest bid
    );
    event AuctionCancelled(uint256 indexed auctionId);
    event WithdrawalProcessed(address indexed bidder, uint256 amount);
    event UnrevealedDepositReclaimed(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event DepositReclaimed(uint256 indexed auctionId, address indexed bidder, uint256 amount);

    error InvalidDuration();
    error InvalidPrice();
    error AuctionNotInPhase(AuctionPhase required, AuctionPhase current);
    error AlreadyCommitted();
    error InsufficientDeposit();
    error InvalidReveal();
    error NotBidder();
    error NotSeller();
    error AlreadySettled();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroAddress();
    error FeeTooHigh();
    error AuctionNotEnded();
    error AlreadyRevealed();
    error NoDepositToReclaim();
    error AuctionNotSettled();  // FIX C-4
    error WinnerCannotReclaim(); // FIX C-4
    error AlreadyReclaimed();    // FIX C-4

    event LosingBidReclaimed(uint256 indexed auctionId, address indexed bidder, uint256 amount);

    constructor(
        uint256 _platformFee,
        address _feeRecipient
    ) Ownable(msg.sender) {
        platformFee = _platformFee;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
        minCommitDuration = 1 hours;
        minRevealDuration = 30 minutes;
    }

    /// @notice Create a new Vickrey auction
    /// @param nftContract The NFT contract address
    /// @param tokenId The token ID to auction
    /// @param reservePrice Minimum acceptable bid
    /// @param commitDuration Length of commit phase
    /// @param revealDuration Length of reveal phase
    function createAuction(
        address nftContract,
        uint256 tokenId,
        uint256 reservePrice,
        uint256 commitDuration,
        uint256 revealDuration
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (commitDuration < minCommitDuration) revert InvalidDuration();
        if (revealDuration < minRevealDuration) revert InvalidDuration();
        if (nftContract == address(0)) revert ZeroAddress();

        // Transfer NFT to contract
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
            reservePrice: reservePrice,
            commitDeadline: block.timestamp + commitDuration,
            revealDeadline: block.timestamp + commitDuration + revealDuration,
            highestBidder: address(0),
            highestBid: 0,
            secondHighestBid: 0,
            settled: false
        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            nftContract,
            tokenId,
            reservePrice
        );
        return auctionId;
    }

    /// @notice Submit a sealed bid commitment
    /// @param auctionId The auction to bid on
    /// @param commitmentHash keccak256(abi.encodePacked(bidAmount, salt))
    /// @dev Deposit must be >= your actual bid (revealed later)
    function commitBid(
        uint256 auctionId,
        bytes32 commitmentHash
    ) external payable whenNotPaused nonReentrant {
        Auction storage auction = auctions[auctionId];

        AuctionPhase phase = getPhase(auctionId);
        if (phase != AuctionPhase.Commit) {
            revert AuctionNotInPhase(AuctionPhase.Commit, phase);
        }

        if (commitments[auctionId][msg.sender].hash != bytes32(0)) {
            revert AlreadyCommitted();
        }

        if (msg.value < auction.reservePrice) revert InsufficientDeposit();

        commitments[auctionId][msg.sender] = Commitment({
            hash: commitmentHash,
            deposit: msg.value,
            revealed: false
        });

        emit BidCommitted(auctionId, msg.sender, msg.value);
    }

    /// @notice Reveal your sealed bid
    /// @param auctionId The auction ID
    /// @param bid Your actual bid amount
    /// @param salt The salt used in commitment
    function revealBid(
        uint256 auctionId,
        uint256 bid,
        bytes32 salt
    ) external whenNotPaused nonReentrant {
        AuctionPhase phase = getPhase(auctionId);
        if (phase != AuctionPhase.Reveal) {
            revert AuctionNotInPhase(AuctionPhase.Reveal, phase);
        }

        Commitment storage commitment = commitments[auctionId][msg.sender];
        if (commitment.hash == bytes32(0)) revert NotBidder();
        if (commitment.revealed) revert InvalidReveal();

        // Verify the commitment
        bytes32 expectedHash = keccak256(abi.encodePacked(bid, salt));
        if (commitment.hash != expectedHash) revert InvalidReveal();
        if (bid > commitment.deposit) revert InvalidReveal();

        commitment.revealed = true;

        Auction storage auction = auctions[auctionId];

        // Update highest/second-highest tracking
        if (bid > auction.highestBid) {
            // New highest bid - previous highest becomes second
            auction.secondHighestBid = auction.highestBid;
            auction.highestBid = bid;
            auction.highestBidder = msg.sender;
        } else if (bid > auction.secondHighestBid) {
            // New second-highest bid
            auction.secondHighestBid = bid;
        }

        // FIX C-4: Only refund excess over bid, keep bid amount for later reclaim
        uint256 excessDeposit = commitment.deposit - bid;
        if (excessDeposit > 0) {
            pendingWithdrawals[msg.sender] += excessDeposit;
        }
        // Store the actual bid amount for potential reclaim by losers
        commitment.deposit = bid;

        emit BidRevealed(auctionId, msg.sender, bid);
    }

    /// @notice Settle the auction after reveal phase ends
    /// @param auctionId The auction to settle
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];

        AuctionPhase phase = getPhase(auctionId);
        if (phase != AuctionPhase.Ended) {
            revert AuctionNotInPhase(AuctionPhase.Ended, phase);
        }
        if (auction.settled) revert AlreadySettled();

        auction.settled = true;

        if (
            auction.highestBidder == address(0) ||
            auction.highestBid < auction.reservePrice
        ) {
            // No valid bids - return NFT to seller
            IERC721(auction.nftContract).safeTransferFrom(
                address(this),
                auction.seller,
                auction.tokenId
            );
            emit AuctionCancelled(auctionId);
            return;
        }

        // Winner pays second-highest price (Vickrey mechanism)
        // If only one bidder, they pay their own bid
        uint256 paidPrice = auction.secondHighestBid > 0
            ? auction.secondHighestBid
            : auction.highestBid;

        // Calculate fees
        uint256 fee = (paidPrice * platformFee) / 10000;
        uint256 sellerProceeds = paidPrice - fee;

        // FIX C-4: Clear winner's deposit and refund excess to pendingWithdrawals
        Commitment storage winnerCommitment = commitments[auctionId][auction.highestBidder];
        uint256 winnerRefund = winnerCommitment.deposit - paidPrice;
        winnerCommitment.deposit = 0; // Clear winner's deposit to prevent any confusion
        if (winnerRefund > 0) {
            pendingWithdrawals[auction.highestBidder] += winnerRefund;
        }

        // Transfer NFT to winner
        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.highestBidder,
            auction.tokenId
        );

        // Distribute payments using pull-pattern to prevent DoS
        // If feeRecipient or seller is a malicious contract that reverts,
        // using direct transfer would brick the settlement. Pull-pattern ensures
        // the auction can always settle, and recipients withdraw separately.
        pendingWithdrawals[feeRecipient] += fee;
        pendingWithdrawals[auction.seller] += sellerProceeds;

        emit AuctionSettled(
            auctionId,
            auction.highestBidder,
            auction.highestBid,
            paidPrice
        );
    }

    /// @notice Withdraw pending funds (refunds, losing bids)
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit WithdrawalProcessed(msg.sender, amount);
    }

    /// @notice Reclaim deposit if bidder did not reveal (can only be called after auction ends)
    /// @dev Allows bidders who committed but didn't reveal to recover their stuck deposits
    /// @param auctionId The auction ID
    function reclaimUnrevealedDeposit(uint256 auctionId) external nonReentrant {
        AuctionPhase phase = getPhase(auctionId);
        if (phase != AuctionPhase.Ended) revert AuctionNotEnded();

        Commitment storage commitment = commitments[auctionId][msg.sender];
        if (commitment.hash == bytes32(0)) revert NoDepositToReclaim();
        if (commitment.revealed) revert AlreadyRevealed();
        if (commitment.deposit == 0) revert NoDepositToReclaim();

        uint256 refund = commitment.deposit;
        commitment.deposit = 0; // Prevent reentrancy and double-claim

        (bool success, ) = payable(msg.sender).call{value: refund}("");
        if (!success) revert TransferFailed();

        emit UnrevealedDepositReclaimed(auctionId, msg.sender, refund);
    }

    /// @notice Reclaim bid after losing auction (FIX C-4)
    /// @param auctionId The auction ID
    /// @dev Only callable after auction is settled, only for revealed losing bids
    function reclaimLosingBid(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        
        // Must be settled
        if (!auction.settled) revert AuctionNotSettled();
        
        Commitment storage commitment = commitments[auctionId][msg.sender];
        
        // Must have revealed (unrevealed deposits use reclaimUnrevealedDeposit)
        if (!commitment.revealed) revert NotBidder();
        
        // Winner cannot use this - their funds handled in settle()
        if (msg.sender == auction.highestBidder) revert WinnerCannotReclaim();
        
        // Must have unclaimed deposit (the bid amount after excess was refunded during reveal)
        if (commitment.deposit == 0) revert AlreadyReclaimed();
        
        uint256 refund = commitment.deposit;
        commitment.deposit = 0;
        
        (bool success, ) = payable(msg.sender).call{value: refund}("");
        if (!success) revert TransferFailed();
        
        emit LosingBidReclaimed(auctionId, msg.sender, refund);
    }

    /// @notice Get current auction phase
    function getPhase(uint256 auctionId) public view returns (AuctionPhase) {
        Auction storage auction = auctions[auctionId];

        if (auction.seller == address(0)) return AuctionPhase.NotStarted;
        if (block.timestamp <= auction.commitDeadline)
            return AuctionPhase.Commit;
        if (block.timestamp <= auction.revealDeadline)
            return AuctionPhase.Reveal;
        return AuctionPhase.Ended;
    }

    /// @notice Generate commitment hash (helper for frontend)
    function getCommitmentHash(
        uint256 bid,
        bytes32 salt
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(bid, salt));
    }

    /// @notice Get auction details
    function getAuction(
        uint256 auctionId
    ) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    // Admin functions
    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > 1000) revert FeeTooHigh();
        platformFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
