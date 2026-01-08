// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ERC721NFTInitializable is
    Initializable,
    ERC721Upgradeable,
    ERC721URIStorageUpgradeable,
    ERC721BurnableUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ERC2981Upgradeable
{
    uint256 private _tokenIdCounter;
    uint256 public maxSupply;
    string private _baseTokenURI;
    mapping(address => bool) public whitelist;
    bool public whitelistEnabled;

    event TokenMinted(address indexed to, uint256 indexed tokenId, string uri);
    event BatchMinted(
        address indexed to,
        uint256 startTokenId,
        uint256 quantity
    );
    event WhitelistUpdated(address indexed account, bool status);
    event MaxSupplyUpdated(uint256 newMaxSupply);
    event BaseURIUpdated(string newBaseURI);

    error MaxSupplyReached();
    error NotWhitelisted();
    error InvalidQuantity();
    error InvalidAddress();
    error AlreadyInitialized();

    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator,
        address owner_
    ) external initializer {
        __ERC721_init(name_, symbol_);
        __ERC721URIStorage_init();
        __ERC721Burnable_init();
        __Ownable_init(owner_);
        __Pausable_init();
        __ERC2981_init();

        maxSupply = maxSupply_;

        if (royaltyReceiver != address(0)) {
            _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        }
    }

    function mint(
        address to,
        string memory uri
    ) public whenNotPaused returns (uint256) {
        if (to == address(0)) revert InvalidAddress();
        if (whitelistEnabled && !whitelist[msg.sender]) revert NotWhitelisted();
        if (maxSupply > 0 && _tokenIdCounter >= maxSupply)
            revert MaxSupplyReached();

        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        emit TokenMinted(to, tokenId, uri);
        return tokenId;
    }

    function batchMint(
        address to,
        uint256 quantity,
        string memory baseURI
    ) public whenNotPaused returns (uint256 startTokenId) {
        if (to == address(0)) revert InvalidAddress();
        if (quantity == 0) revert InvalidQuantity();
        if (whitelistEnabled && !whitelist[msg.sender]) revert NotWhitelisted();
        if (maxSupply > 0 && _tokenIdCounter + quantity > maxSupply)
            revert MaxSupplyReached();

        startTokenId = _tokenIdCounter;

        unchecked {
            for (uint256 i = 0; i < quantity; i++) {
                uint256 tokenId = _tokenIdCounter++;
                _safeMint(to, tokenId);
                if (bytes(baseURI).length > 0) {
                    _setTokenURI(
                        tokenId,
                        string(abi.encodePacked(baseURI, _toString(tokenId)))
                    );
                }
            }
        }

        emit BatchMinted(to, startTokenId, quantity);
        return startTokenId;
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

    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(
            newMaxSupply >= _tokenIdCounter,
            "Cannot set max supply below current supply"
        );
        maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(newMaxSupply);
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }

    function setDefaultRoyalty(
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(
        uint256 tokenId
    )
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override whenNotPaused returns (address) {
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(
            ERC721Upgradeable,
            ERC721URIStorageUpgradeable,
            ERC2981Upgradeable
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
