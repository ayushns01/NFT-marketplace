// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockERC721NoRoyalty
 * @notice Bare ERC721 that does NOT implement ERC2981 (no royaltyInfo function)
 * @dev Used to test catch{} branches on royaltyInfo calls
 */
contract MockERC721NoRoyalty is ERC721 {
    uint256 private _tokenIdCounter;

    constructor() ERC721("NoRoyaltyNFT", "NRNFT") {}

    function mint(address to) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        return tokenId;
    }
}
