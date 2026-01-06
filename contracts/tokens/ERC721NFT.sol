// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/**
 * @title ERC721NFT
 * @dev Gas-optimized ERC-721 implementation with royalty support
 * @notice This contract implements:
 *  - ERC-721 standard for NFTs
 *  - ERC-2981 for royalty information
 *  - Pausable for emergency stops
 *  - Burnable for token destruction
 *  - Batch minting for gas efficiency
 */
contract ERC721NFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, Pausable, ERC2981 {
    
    // ============================================
    // STATE VARIABLES
    // ============================================
    
    /// @notice Counter for token IDs
    uint256 private _tokenIdCounter;
    
    /// @notice Maximum supply of tokens (0 = unlimited)
    uint256 public maxSupply;
    
    /// @notice Base URI for token metadata
    string private _baseTokenURI;
    
    /// @notice Mapping to track if an address is whitelisted for minting
    mapping(address => bool) public whitelist;
    
    /// @notice Flag to enable/disable whitelist requirement
    bool public whitelistEnabled;
    
    // ============================================
    // EVENTS
    // ============================================
    
    event TokenMinted(address indexed to, uint256 indexed tokenId, string uri);
    event BatchMinted(address indexed to, uint256 startTokenId, uint256 quantity);
    event WhitelistUpdated(address indexed account, bool status);
    event MaxSupplyUpdated(uint256 newMaxSupply);
    event BaseURIUpdated(string newBaseURI);
    
    // ============================================
    // ERRORS (Gas-efficient custom errors)
    // ============================================
    
    error MaxSupplyReached();
    error NotWhitelisted();
    error InvalidQuantity();
    error InvalidAddress();
    error InvalidTokenId();
    
    // ============================================
    // CONSTRUCTOR
    // ============================================
    
    /**
     * @dev Initializes the NFT collection
     * @param name_ Name of the NFT collection
     * @param symbol_ Symbol of the NFT collection
     * @param maxSupply_ Maximum supply (0 for unlimited)
     * @param royaltyReceiver Address to receive royalties
     * @param royaltyFeeNumerator Royalty percentage in basis points (e.g., 500 = 5%)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        maxSupply = maxSupply_;
        
        // Set default royalty for all tokens
        if (royaltyReceiver != address(0)) {
            _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
        }
    }
    
    // ============================================
    // MINTING FUNCTIONS
    // ============================================
    
    /**
     * @notice Mint a single NFT
     * @dev Checks whitelist if enabled, respects max supply
     * @param to Address to mint the NFT to
     * @param uri Metadata URI for the token
     * @return tokenId The ID of the minted token
     */
    function mint(address to, string memory uri) 
        public 
        whenNotPaused 
        returns (uint256) 
    {
        // Validate address
        if (to == address(0)) revert InvalidAddress();
        
        // Check whitelist if enabled
        if (whitelistEnabled && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }
        
        // Check max supply
        if (maxSupply > 0 && _tokenIdCounter >= maxSupply) {
            revert MaxSupplyReached();
        }
        
        uint256 tokenId = _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        emit TokenMinted(to, tokenId, uri);
        
        return tokenId;
    }
    
    /**
     * @notice Batch mint multiple NFTs (gas-efficient)
     * @dev Mints multiple tokens in a single transaction
     * @param to Address to mint the NFTs to
     * @param quantity Number of NFTs to mint
     * @param baseURI Base URI for metadata (will append tokenId)
     */
    function batchMint(
        address to, 
        uint256 quantity, 
        string memory baseURI
    ) 
        public 
        whenNotPaused 
        returns (uint256 startTokenId) 
    {
        if (to == address(0)) revert InvalidAddress();
        if (quantity == 0) revert InvalidQuantity();
        
        // Check whitelist if enabled
        if (whitelistEnabled && !whitelist[msg.sender]) {
            revert NotWhitelisted();
        }
        
        // Check max supply
        if (maxSupply > 0 && _tokenIdCounter + quantity > maxSupply) {
            revert MaxSupplyReached();
        }
        
        startTokenId = _tokenIdCounter;
        
        // Mint tokens in a loop (gas-optimized)
        unchecked {
            for (uint256 i = 0; i < quantity; i++) {
                uint256 tokenId = _tokenIdCounter++;
                _safeMint(to, tokenId);
                
                // Set URI if provided
                if (bytes(baseURI).length > 0) {
                    _setTokenURI(tokenId, string(abi.encodePacked(baseURI, _toString(tokenId))));
                }
            }
        }
        
        emit BatchMinted(to, startTokenId, quantity);
        
        return startTokenId;
    }
    
    // ============================================
    // WHITELIST FUNCTIONS
    // ============================================
    
    /**
     * @notice Add or remove an address from the whitelist
     * @param account Address to update
     * @param status True to whitelist, false to remove
     */
    function setWhitelist(address account, bool status) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }
    
    /**
     * @notice Batch update whitelist (gas-efficient)
     * @param accounts Array of addresses to update
     * @param status True to whitelist, false to remove
     */
    function batchSetWhitelist(address[] calldata accounts, bool status) external onlyOwner {
        unchecked {
            for (uint256 i = 0; i < accounts.length; i++) {
                if (accounts[i] != address(0)) {
                    whitelist[accounts[i]] = status;
                    emit WhitelistUpdated(accounts[i], status);
                }
            }
        }
    }
    
    /**
     * @notice Enable or disable whitelist requirement
     * @param enabled True to enable whitelist, false to disable
     */
    function setWhitelistEnabled(bool enabled) external onlyOwner {
        whitelistEnabled = enabled;
    }
    
    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    
    /**
     * @notice Update the maximum supply
     * @param newMaxSupply New maximum supply (must be >= current supply)
     */
    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        require(newMaxSupply >= _tokenIdCounter, "Cannot set max supply below current supply");
        maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(newMaxSupply);
    }
    
    /**
     * @notice Set the base URI for all tokens
     * @param baseURI New base URI
     */
    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }
    
    /**
     * @notice Update royalty information
     * @param receiver Address to receive royalties
     * @param feeNumerator Royalty percentage in basis points
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }
    
    /**
     * @notice Pause all token transfers
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Unpause token transfers
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============================================
    // VIEW FUNCTIONS
    // ============================================
    
    /**
     * @notice Get the total number of tokens minted
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }
    
    /**
     * @notice Get the base URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
    
    // ============================================
    // REQUIRED OVERRIDES
    // ============================================
    
    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
    
    /**
     * @dev Override to add pausable functionality to transfers
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        whenNotPaused
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
    
    /**
     * @dev Override required for ERC2981 royalty support
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
    
    // ============================================
    // INTERNAL HELPER FUNCTIONS
    // ============================================
    
    /**
     * @dev Convert uint256 to string (gas-efficient)
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
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
