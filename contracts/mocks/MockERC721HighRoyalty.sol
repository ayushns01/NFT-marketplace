// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title MockERC721HighRoyalty
 * @notice ERC721 with 50% royalty to test the 10% royalty cap
 * @dev Returns royaltyInfo with 50% of salePrice, which should be capped to 10%
 */
contract MockERC721HighRoyalty is ERC721, IERC2981 {
    uint256 private _tokenIdCounter;
    address public royaltyReceiver;

    constructor(address _royaltyReceiver) ERC721("HighRoyaltyNFT", "HRNFT") {
        royaltyReceiver = _royaltyReceiver;
    }

    function mint(address to) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    /// @dev Returns 50% royalty — should be capped at 10% by marketplace contracts
    function royaltyInfo(
        uint256,
        uint256 salePrice
    ) external view override returns (address receiver, uint256 royaltyAmount) {
        return (royaltyReceiver, salePrice / 2); // 50% royalty
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, IERC165) returns (bool) {
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
