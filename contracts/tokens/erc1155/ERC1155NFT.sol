// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

contract ERC1155NFT is
    ERC1155,
    ERC1155Burnable,
    ERC1155Supply,
    Ownable,
    Pausable,
    ERC2981
{
    string public name;
    string public symbol;

    uint256 private _tokenIdCounter;

    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => uint256) public maxSupplyPerToken;
    mapping(address => bool) public whitelist;
    bool public whitelistEnabled;

    event TokenMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 amount,
        string uri
    );
    event BatchMinted(
        address indexed to,
        uint256[] tokenIds,
        uint256[] amounts
    );
    event WhitelistUpdated(address indexed account, bool status);
    event TokenURIUpdated(uint256 indexed tokenId, string uri);

    error MaxSupplyReached(uint256 tokenId);
    error NotWhitelisted();
    error InvalidQuantity();
    error InvalidAddress();
    error ArrayLengthMismatch();
    error TokenDoesNotExist(uint256 tokenId);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator
    ) ERC1155(baseURI_) Ownable(msg.sender) {
        name = name_;
        symbol = symbol_;

        if (royaltyReceiver != address(0)) {
            _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        }
    }

    function mint(
        address to,
        uint256 amount,
        string memory tokenURI_
    ) public whenNotPaused returns (uint256) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidQuantity();

        if (whitelistEnabled && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }

        uint256 tokenId = _tokenIdCounter++;

        _mint(to, tokenId, amount, "");
        _tokenURIs[tokenId] = tokenURI_;

        emit TokenMinted(to, tokenId, amount, tokenURI_);

        return tokenId;
    }

    function mintExisting(
        address to,
        uint256 tokenId,
        uint256 amount
    ) public whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidQuantity();
        if (!exists(tokenId)) revert TokenDoesNotExist(tokenId);

        if (whitelistEnabled && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }

        uint256 maxSupply = maxSupplyPerToken[tokenId];
        if (maxSupply > 0 && totalSupply(tokenId) + amount > maxSupply) {
            revert MaxSupplyReached(tokenId);
        }

        _mint(to, tokenId, amount, "");
    }

    function mintBatch(
        address to,
        uint256[] memory amounts,
        string[] memory tokenURIs
    ) public whenNotPaused returns (uint256[] memory) {
        if (to == address(0)) revert InvalidAddress();
        if (amounts.length != tokenURIs.length) revert ArrayLengthMismatch();

        if (whitelistEnabled && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }

        uint256[] memory tokenIds = new uint256[](amounts.length);

        unchecked {
            for (uint256 i = 0; i < amounts.length; i++) {
                if (amounts[i] == 0) revert InvalidQuantity();
                tokenIds[i] = _tokenIdCounter++;
                _tokenURIs[tokenIds[i]] = tokenURIs[i];
            }
        }

        _mintBatch(to, tokenIds, amounts, "");

        emit BatchMinted(to, tokenIds, amounts);

        return tokenIds;
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenURI_ = _tokenURIs[tokenId];

        if (bytes(tokenURI_).length > 0) {
            return tokenURI_;
        }

        return super.uri(tokenId);
    }

    function setTokenURI(
        uint256 tokenId,
        string memory tokenURI_
    ) external onlyOwner {
        _tokenURIs[tokenId] = tokenURI_;
        emit TokenURIUpdated(tokenId, tokenURI_);
    }

    function setBaseURI(string memory baseURI_) external onlyOwner {
        _setURI(baseURI_);
    }

    function setMaxSupply(
        uint256 tokenId,
        uint256 maxSupply
    ) external onlyOwner {
        require(
            maxSupply >= totalSupply(tokenId),
            "Max supply below current supply"
        );
        maxSupplyPerToken[tokenId] = maxSupply;
    }

    function setWhitelist(address account, bool status) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }

    function batchSetWhitelist(
        address[] calldata accounts,
        bool status
    ) external onlyOwner {
        unchecked {
            for (uint256 i = 0; i < accounts.length; i++) {
                if (accounts[i] != address(0)) {
                    whitelist[accounts[i]] = status;
                    emit WhitelistUpdated(accounts[i], status);
                }
            }
        }
    }

    function setWhitelistEnabled(bool enabled) external onlyOwner {
        whitelistEnabled = enabled;
    }

    function setDefaultRoyalty(
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function totalTokenTypes() public view returns (uint256) {
        return _tokenIdCounter;
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) whenNotPaused {
        super._update(from, to, ids, values);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
