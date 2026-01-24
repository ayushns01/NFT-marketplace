// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "../tokens/erc721/ERC721NFTInitializable.sol";

contract LazyMinting is EIP712, Ownable, ReentrancyGuard, Pausable {
    struct NFTVoucher {
        uint256 tokenId;
        uint256 price;
        string uri;
        address creator;
        address nftContract;
        uint256 royaltyFee;
        uint256 nonce;
    }

    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256(
            "NFTVoucher(uint256 tokenId,uint256 price,string uri,address creator,address nftContract,uint256 royaltyFee,uint256 nonce)"
        );

    uint256 public platformFee;
    address public feeRecipient;

    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(address => bool) public authorizedContracts;

    event VoucherRedeemed(
        address indexed buyer,
        address indexed creator,
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );

    event ContractAuthorized(address indexed nftContract, bool authorized);
    event PlatformFeeUpdated(uint256 newFee);

    error InvalidSignature();
    error NonceAlreadyUsed();
    error InsufficientPayment();
    error UnauthorizedContract();
    error InvalidPrice();
    error TransferFailed();
    error ZeroAddress();
    error FeeTooHigh();

    constructor(
        uint256 _platformFee,
        address _feeRecipient
    ) EIP712("LazyMinting", "1") Ownable(msg.sender) {
        platformFee = _platformFee;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
    }

    function redeem(
        NFTVoucher calldata voucher,
        bytes calldata signature
    ) external payable whenNotPaused nonReentrant returns (uint256) {
        if (msg.value < voucher.price) revert InsufficientPayment();
        if (voucher.price == 0) revert InvalidPrice();
        if (!authorizedContracts[voucher.nftContract])
            revert UnauthorizedContract();
        if (usedNonces[voucher.creator][voucher.nonce])
            revert NonceAlreadyUsed();

        address signer = _verify(voucher, signature);
        if (signer != voucher.creator) revert InvalidSignature();

        usedNonces[voucher.creator][voucher.nonce] = true;

        ERC721NFTInitializable nft = ERC721NFTInitializable(
            voucher.nftContract
        );
        nft.mint(msg.sender, voucher.uri);

        _distributePayment(voucher);

        if (msg.value > voucher.price) {
            (bool success, ) = payable(msg.sender).call{
                value: msg.value - voucher.price
            }("");
            if (!success) revert TransferFailed();
        }

        emit VoucherRedeemed(
            msg.sender,
            voucher.creator,
            voucher.nftContract,
            voucher.tokenId,
            voucher.price
        );

        return voucher.tokenId;
    }

    function _verify(
        NFTVoucher calldata voucher,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    VOUCHER_TYPEHASH,
                    voucher.tokenId,
                    voucher.price,
                    keccak256(bytes(voucher.uri)),
                    voucher.creator,
                    voucher.nftContract,
                    voucher.royaltyFee,
                    voucher.nonce
                )
            )
        );

        return ECDSA.recover(digest, signature);
    }

    function _distributePayment(NFTVoucher calldata voucher) internal {
        uint256 platformAmount = (voucher.price * platformFee) / 10000;
        uint256 royaltyAmount = (voucher.price * voucher.royaltyFee) / 10000;
        uint256 creatorAmount = voucher.price - platformAmount - royaltyAmount;

        if (platformAmount > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{
                value: platformAmount
            }("");
            if (!feeSuccess) revert TransferFailed();
        }

        if (royaltyAmount > 0) {
            (bool royaltySuccess, ) = payable(voucher.creator).call{
                value: royaltyAmount
            }("");
            if (!royaltySuccess) revert TransferFailed();
        }

        (bool creatorSuccess, ) = payable(voucher.creator).call{
            value: creatorAmount
        }("");
        if (!creatorSuccess) revert TransferFailed();
    }

    function authorizeContract(
        address nftContract,
        bool authorized
    ) external onlyOwner {
        if (nftContract == address(0)) revert ZeroAddress();
        authorizedContracts[nftContract] = authorized;
        emit ContractAuthorized(nftContract, authorized);
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getChainId() external view returns (uint256) {
        return block.chainid;
    }
}
