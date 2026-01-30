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

contract Marketplace is
    Ownable,
    ReentrancyGuard,
    Pausable,
    ERC721Holder,
    ERC1155Holder
{
    enum TokenType {
        ERC721,
        ERC1155
    }
    enum ListingStatus {
        Active,
        Sold,
        Cancelled
    }

    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        uint256 price;
        TokenType tokenType;
        ListingStatus status;
        uint256 createdAt;
    }

    struct Offer {
        address buyer;
        uint256 price;
        uint256 expiresAt;
        bool accepted;
    }

    uint256 private _listingIdCounter;
    uint256 public platformFee;
    address public feeRecipient;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer[]) public listingOffers;
    mapping(address => uint256[]) public userListings;
    mapping(address => mapping(address => mapping(uint256 => uint256)))
        public activeListingId;
    mapping(uint256 => uint256) public listingCreatedBlock; // Listing-level flash loan protection
    mapping(address => uint256) public pendingWithdrawals; // Pull-pattern for payments

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 price,
        TokenType tokenType
    );

    event Sale(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    event ListingCancelled(uint256 indexed listingId);
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);
    event OfferCreated(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 price,
        uint256 expiresAt
    );
    event OfferAccepted(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 price
    );
    event OfferCancelled(uint256 indexed listingId, uint256 offerIndex);
    event PlatformFeeUpdated(uint256 newFee);
    event FeeRecipientUpdated(address newRecipient);
    event FundsWithdrawn(address indexed recipient, uint256 amount);

    error InvalidPrice();
    error InvalidAmount();
    error NotSeller();
    error NotBuyer();
    error ListingNotActive();
    error InsufficientPayment();
    error InvalidListing();
    error OfferExpired();
    error OfferNotFound();
    error TransferFailed();
    error NotTokenOwner();
    error ZeroAddress();
    error FeeTooHigh();
    error SameBlockPurchase();
    error NothingToWithdraw();

    /// @notice Prevents same-block purchase of newly created listings to resist flash loan attacks
    modifier noSameBlockPurchase(uint256 listingId) {
        if (block.number == listingCreatedBlock[listingId])
            revert SameBlockPurchase();
        _;
    }

    constructor(
        uint256 _platformFee,
        address _feeRecipient
    ) Ownable(msg.sender) {
        platformFee = _platformFee;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
    }

    function listERC721(
        address nftContract,
        uint256 tokenId,
        uint256 price
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (nftContract == address(0)) revert ZeroAddress();

        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        nft.safeTransferFrom(msg.sender, address(this), tokenId);

        uint256 listingId = _listingIdCounter++;

        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: 1,
            price: price,
            tokenType: TokenType.ERC721,
            status: ListingStatus.Active,
            createdAt: block.timestamp
        });

        listingCreatedBlock[listingId] = block.number;
        userListings[msg.sender].push(listingId);
        activeListingId[msg.sender][nftContract][tokenId] = listingId;

        emit Listed(
            listingId,
            msg.sender,
            nftContract,
            tokenId,
            1,
            price,
            TokenType.ERC721
        );

        return listingId;
    }

    function listERC1155(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 price
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (amount == 0) revert InvalidAmount();
        if (nftContract == address(0)) revert ZeroAddress();

        IERC1155 nft = IERC1155(nftContract);

        nft.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        uint256 listingId = _listingIdCounter++;

        listings[listingId] = Listing({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            amount: amount,
            price: price,
            tokenType: TokenType.ERC1155,
            status: ListingStatus.Active,
            createdAt: block.timestamp
        });

        listingCreatedBlock[listingId] = block.number;
        userListings[msg.sender].push(listingId);
        activeListingId[msg.sender][nftContract][tokenId] = listingId;

        emit Listed(
            listingId,
            msg.sender,
            nftContract,
            tokenId,
            amount,
            price,
            TokenType.ERC1155
        );

        return listingId;
    }

    function buy(
        uint256 listingId
    )
        external
        payable
        whenNotPaused
        nonReentrant
        noSameBlockPurchase(listingId)
    {
        Listing storage listing = listings[listingId];

        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (msg.value < listing.price) revert InsufficientPayment();

        listing.status = ListingStatus.Sold;

        _executeSale(listing, msg.sender, listing.price);

        emit Sale(listingId, listing.seller, msg.sender, listing.price);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        listing.status = ListingStatus.Cancelled;

        if (listing.tokenType == TokenType.ERC721) {
            IERC721(listing.nftContract).safeTransferFrom(
                address(this),
                msg.sender,
                listing.tokenId
            );
        } else {
            IERC1155(listing.nftContract).safeTransferFrom(
                address(this),
                msg.sender,
                listing.tokenId,
                listing.amount,
                ""
            );
        }

        emit ListingCancelled(listingId);
    }

    function updatePrice(uint256 listingId, uint256 newPrice) external nonReentrant {
        if (newPrice == 0) revert InvalidPrice();

        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        listing.price = newPrice;

        emit ListingUpdated(listingId, newPrice);
    }

    function makeOffer(
        uint256 listingId,
        uint256 expiresAt
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert InvalidPrice();

        Listing storage listing = listings[listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        listingOffers[listingId].push(
            Offer({
                buyer: msg.sender,
                price: msg.value,
                expiresAt: expiresAt,
                accepted: false
            })
        );

        emit OfferCreated(listingId, msg.sender, msg.value, expiresAt);
    }

    function acceptOffer(
        uint256 listingId,
        uint256 offerIndex
    ) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        Offer storage offer = listingOffers[listingId][offerIndex];

        if (offer.expiresAt != 0 && block.timestamp > offer.expiresAt)
            revert OfferExpired();
        if (offer.accepted) revert OfferNotFound();

        offer.accepted = true;
        listing.status = ListingStatus.Sold;

        _executeSale(listing, offer.buyer, offer.price);

        emit OfferAccepted(listingId, offer.buyer, offer.price);
    }

    function cancelOffer(
        uint256 listingId,
        uint256 offerIndex
    ) external nonReentrant {
        Offer storage offer = listingOffers[listingId][offerIndex];

        if (offer.buyer != msg.sender) revert NotBuyer();
        if (offer.accepted) revert OfferNotFound();

        uint256 refund = offer.price;
        offer.price = 0;

        (bool success, ) = payable(msg.sender).call{value: refund}("");
        if (!success) revert TransferFailed();

        emit OfferCancelled(listingId, offerIndex);
    }

    function _executeSale(
        Listing storage listing,
        address buyer,
        uint256 price
    ) internal {
        uint256 platformAmount = (price * platformFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient = address(0);

        try
            IERC2981(listing.nftContract).royaltyInfo(listing.tokenId, price)
        returns (address receiver, uint256 amount) {
            royaltyRecipient = receiver;
            // Cap royalty at 10% to prevent malicious NFT contracts
            royaltyAmount = amount > (price / 10) ? (price / 10) : amount;
        } catch {}
        uint256 sellerAmount = price - platformAmount - royaltyAmount;

        if (listing.tokenType == TokenType.ERC721) {
            IERC721(listing.nftContract).safeTransferFrom(
                address(this),
                buyer,
                listing.tokenId
            );
        } else {
            IERC1155(listing.nftContract).safeTransferFrom(
                address(this),
                buyer,
                listing.tokenId,
                listing.amount,
                ""
            );
        }

        // Platform fee: direct transfer (trusted recipient)
        if (platformAmount > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{
                value: platformAmount
            }("");
            if (!feeSuccess) revert TransferFailed();
        }

        // Royalty and seller: pull-pattern to prevent DoS
        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            pendingWithdrawals[royaltyRecipient] += royaltyAmount;
        }

        pendingWithdrawals[listing.seller] += sellerAmount;
    }

    /// @notice Withdraw accumulated funds from sales and royalties
    function withdrawFunds() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit FundsWithdrawn(msg.sender, amount);
    }

    function getListing(
        uint256 listingId
    ) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getOffers(
        uint256 listingId
    ) external view returns (Offer[] memory) {
        return listingOffers[listingId];
    }

    function getUserListings(
        address user
    ) external view returns (uint256[] memory) {
        return userListings[user];
    }

    function getTotalListings() external view returns (uint256) {
        return _listingIdCounter;
    }

    function setPlatformFee(uint256 newFee) external onlyOwner {
        if (newFee > 1000) revert FeeTooHigh();
        platformFee = newFee;
        emit PlatformFeeUpdated(newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
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
