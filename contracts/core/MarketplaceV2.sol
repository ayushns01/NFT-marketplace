// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// Use standard interfaces (OZ v5 compatible)
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Upgradeable base contracts
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title MarketplaceV2
 * @notice Upgradeable NFT marketplace with role-based access control and ERC20 payments
 * @dev UUPS proxy pattern with AccessControl for decentralized governance
 *
 * Architecture improvements over V1:
 * - UUPS upgradeability for future improvements
 * - Role-based access control (not single owner)
 * - ERC20 token payments (WETH, USDC, etc.)
 * - Flash loan resistance
 */
contract MarketplaceV2 is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ERC721HolderUpgradeable,
    ERC1155HolderUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Roles ============
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ============ Enums ============
    enum TokenType {
        ERC721,
        ERC1155
    }
    enum ListingStatus {
        Active,
        Sold,
        Cancelled
    }
    enum PaymentMethod {
        ETH,
        ERC20
    }

    // ============ Structs ============
    struct Listing {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 amount;
        uint256 price;
        TokenType tokenType;
        ListingStatus status;
        address paymentToken; // address(0) = ETH
        uint256 createdAt;
    }

    struct Offer {
        address buyer;
        uint256 price;
        address paymentToken;
        uint256 expiresAt;
        bool accepted;
    }

    // ============ State Variables ============
    uint256 private _listingIdCounter;
    uint256 public platformFee; // Basis points (e.g., 250 = 2.5%)
    address public feeRecipient;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer[]) public listingOffers;
    mapping(address => uint256[]) public userListings;
    mapping(address => mapping(address => mapping(uint256 => uint256)))
        public activeListingId;
    mapping(address => uint256) public lastInteractionBlock;
    mapping(address => bool) public acceptedTokens; // Whitelisted ERC20s

    // ============ Events ============
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 price,
        TokenType tokenType,
        address paymentToken
    );
    event Sale(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        address paymentToken
    );
    event ListingCancelled(uint256 indexed listingId);
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);
    event OfferCreated(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 price,
        address paymentToken
    );
    event OfferAccepted(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 price
    );
    event OfferCancelled(uint256 indexed listingId, uint256 offerIndex);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event TokenWhitelisted(address indexed token, bool status);

    // ============ Errors ============
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
    error FlashLoanBlocked();
    error TokenNotAccepted();
    error PaymentMethodMismatch();

    // ============ Modifiers ============
    modifier noFlashLoan() {
        if (block.number == lastInteractionBlock[msg.sender])
            revert FlashLoanBlocked();
        lastInteractionBlock[msg.sender] = block.number;
        _;
    }

    // ============ Initializer ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _platformFee,
        address _feeRecipient,
        address _admin
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __ERC721Holder_init();
        __ERC1155Holder_init();

        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();
        if (_platformFee > 1000) revert FeeTooHigh();

        platformFee = _platformFee;
        feeRecipient = _feeRecipient;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(FEE_MANAGER_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
    }

    // ============ Listing Functions ============
    function listERC721(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        address paymentToken
    ) external whenNotPaused nonReentrant noFlashLoan returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (nftContract == address(0)) revert ZeroAddress();
        if (paymentToken != address(0) && !acceptedTokens[paymentToken])
            revert TokenNotAccepted();

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
            paymentToken: paymentToken,
            createdAt: block.timestamp
        });

        userListings[msg.sender].push(listingId);
        activeListingId[msg.sender][nftContract][tokenId] = listingId;

        emit Listed(
            listingId,
            msg.sender,
            nftContract,
            tokenId,
            1,
            price,
            TokenType.ERC721,
            paymentToken
        );
        return listingId;
    }

    function listERC1155(
        address nftContract,
        uint256 tokenId,
        uint256 amount,
        uint256 price,
        address paymentToken
    ) external whenNotPaused nonReentrant noFlashLoan returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (amount == 0) revert InvalidAmount();
        if (nftContract == address(0)) revert ZeroAddress();
        if (paymentToken != address(0) && !acceptedTokens[paymentToken])
            revert TokenNotAccepted();

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
            paymentToken: paymentToken,
            createdAt: block.timestamp
        });

        userListings[msg.sender].push(listingId);
        activeListingId[msg.sender][nftContract][tokenId] = listingId;

        emit Listed(
            listingId,
            msg.sender,
            nftContract,
            tokenId,
            amount,
            price,
            TokenType.ERC1155,
            paymentToken
        );
        return listingId;
    }

    // ============ Buy Functions ============
    function buy(
        uint256 listingId
    ) external payable whenNotPaused nonReentrant noFlashLoan {
        Listing storage listing = listings[listingId];

        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (listing.paymentToken != address(0)) revert PaymentMethodMismatch();
        if (msg.value < listing.price) revert InsufficientPayment();

        listing.status = ListingStatus.Sold;
        _executeSaleETH(listing, msg.sender, listing.price);

        // Refund excess
        if (msg.value > listing.price) {
            (bool success, ) = payable(msg.sender).call{
                value: msg.value - listing.price
            }("");
            if (!success) revert TransferFailed();
        }

        emit Sale(
            listingId,
            listing.seller,
            msg.sender,
            listing.price,
            address(0)
        );
    }

    function buyWithToken(
        uint256 listingId,
        uint256 maxAmount
    ) external whenNotPaused nonReentrant noFlashLoan {
        Listing storage listing = listings[listingId];

        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (listing.paymentToken == address(0)) revert PaymentMethodMismatch();
        if (maxAmount < listing.price) revert InsufficientPayment();

        listing.status = ListingStatus.Sold;
        _executeSaleERC20(listing, msg.sender, listing.price);

        emit Sale(
            listingId,
            listing.seller,
            msg.sender,
            listing.price,
            listing.paymentToken
        );
    }

    // ============ Internal Sale Execution ============
    function _executeSaleETH(
        Listing storage listing,
        address buyer,
        uint256 price
    ) internal {
        uint256 platformAmount = (price * platformFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient;

        // Try to get royalty info (EIP-2981)
        try
            IERC2981(listing.nftContract).royaltyInfo(listing.tokenId, price)
        returns (address receiver, uint256 amount) {
            royaltyRecipient = receiver;
            royaltyAmount = amount;
        } catch {}
        uint256 sellerAmount = price - platformAmount - royaltyAmount;

        // Transfer NFT
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

        // Distribute payments
        if (platformAmount > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{
                value: platformAmount
            }("");
            if (!feeSuccess) revert TransferFailed();
        }

        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            (bool royaltySuccess, ) = payable(royaltyRecipient).call{
                value: royaltyAmount
            }("");
            if (!royaltySuccess) revert TransferFailed();
        }

        (bool sellerSuccess, ) = payable(listing.seller).call{
            value: sellerAmount
        }("");
        if (!sellerSuccess) revert TransferFailed();
    }

    function _executeSaleERC20(
        Listing storage listing,
        address buyer,
        uint256 price
    ) internal {
        IERC20 token = IERC20(listing.paymentToken);

        uint256 platformAmount = (price * platformFee) / 10000;
        uint256 royaltyAmount = 0;
        address royaltyRecipient;

        try
            IERC2981(listing.nftContract).royaltyInfo(listing.tokenId, price)
        returns (address receiver, uint256 amount) {
            royaltyRecipient = receiver;
            royaltyAmount = amount;
        } catch {}
        uint256 sellerAmount = price - platformAmount - royaltyAmount;

        // Transfer NFT
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

        // Transfer tokens using SafeERC20
        token.safeTransferFrom(buyer, feeRecipient, platformAmount);

        if (royaltyAmount > 0 && royaltyRecipient != address(0)) {
            token.safeTransferFrom(buyer, royaltyRecipient, royaltyAmount);
        }

        token.safeTransferFrom(buyer, listing.seller, sellerAmount);
    }

    // ============ Cancel & Update ============
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

    function updatePrice(uint256 listingId, uint256 newPrice) external {
        if (newPrice == 0) revert InvalidPrice();

        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.status != ListingStatus.Active) revert ListingNotActive();

        listing.price = newPrice;
        emit ListingUpdated(listingId, newPrice);
    }

    // ============ Admin Functions ============
    function setPlatformFee(
        uint256 newFee
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (newFee > 1000) revert FeeTooHigh();
        uint256 oldFee = platformFee;
        platformFee = newFee;
        emit PlatformFeeUpdated(oldFee, newFee);
    }

    function setFeeRecipient(
        address newRecipient
    ) external onlyRole(ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    function setAcceptedToken(
        address token,
        bool accepted
    ) external onlyRole(ADMIN_ROLE) {
        acceptedTokens[token] = accepted;
        emit TokenWhitelisted(token, accepted);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============ View Functions ============
    function getListing(
        uint256 listingId
    ) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getUserListings(
        address user
    ) external view returns (uint256[] memory) {
        return userListings[user];
    }

    function getTotalListings() external view returns (uint256) {
        return _listingIdCounter;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ============ UUPS Required ============
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {}

    // ============ ERC165 ============
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(AccessControlUpgradeable, ERC1155HolderUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
