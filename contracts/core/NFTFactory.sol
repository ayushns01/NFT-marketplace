// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../tokens/erc721/ERC721NFTInitializable.sol";
import "../tokens/erc1155/ERC1155NFTInitializable.sol";

contract NFTFactory is Ownable {
    using Clones for address;

    address public erc721Implementation;
    address public erc1155Implementation;

    uint256 public creationFee;

    address[] public deployedERC721Collections;
    address[] public deployedERC1155Collections;

    mapping(address => address[]) public creatorToCollections;
    mapping(address => bool) public isFactoryCollection;

    event ERC721CollectionCreated(
        address indexed collection,
        address indexed creator,
        string name,
        string symbol
    );

    event ERC1155CollectionCreated(
        address indexed collection,
        address indexed creator,
        string name,
        string symbol
    );

    event ImplementationUpdated(string tokenType, address newImplementation);
    event CreationFeeUpdated(uint256 newFee);

    error InsufficientFee();
    error InvalidImplementation();
    error TransferFailed();

    constructor(
        address _erc721Implementation,
        address _erc1155Implementation
    ) Ownable(msg.sender) {
        erc721Implementation = _erc721Implementation;
        erc1155Implementation = _erc1155Implementation;
    }

    function createERC721Collection(
        string memory name,
        string memory symbol,
        uint256 maxSupply,
        address royaltyReceiver,
        uint96 royaltyFee
    ) external payable returns (address) {
        if (msg.value < creationFee) revert InsufficientFee();

        bytes32 salt = keccak256(
            abi.encodePacked(msg.sender, name, symbol, block.timestamp)
        );

        address clone = erc721Implementation.cloneDeterministic(salt);

        ERC721NFTInitializable(clone).initialize(
            name,
            symbol,
            maxSupply,
            royaltyReceiver,
            royaltyFee,
            msg.sender
        );

        deployedERC721Collections.push(clone);
        creatorToCollections[msg.sender].push(clone);
        isFactoryCollection[clone] = true;

        emit ERC721CollectionCreated(clone, msg.sender, name, symbol);

        return clone;
    }

    function createERC1155Collection(
        string memory name,
        string memory symbol,
        string memory baseURI,
        address royaltyReceiver,
        uint96 royaltyFee
    ) external payable returns (address) {
        if (msg.value < creationFee) revert InsufficientFee();

        bytes32 salt = keccak256(
            abi.encodePacked(msg.sender, name, symbol, block.timestamp)
        );

        address clone = erc1155Implementation.cloneDeterministic(salt);

        ERC1155NFTInitializable(clone).initialize(
            name,
            symbol,
            baseURI,
            royaltyReceiver,
            royaltyFee,
            msg.sender
        );

        deployedERC1155Collections.push(clone);
        creatorToCollections[msg.sender].push(clone);
        isFactoryCollection[clone] = true;

        emit ERC1155CollectionCreated(clone, msg.sender, name, symbol);

        return clone;
    }

    function predictERC721Address(
        address creator,
        string memory name,
        string memory symbol,
        uint256 timestamp
    ) external view returns (address) {
        bytes32 salt = keccak256(
            abi.encodePacked(creator, name, symbol, timestamp)
        );
        return erc721Implementation.predictDeterministicAddress(salt);
    }

    function predictERC1155Address(
        address creator,
        string memory name,
        string memory symbol,
        uint256 timestamp
    ) external view returns (address) {
        bytes32 salt = keccak256(
            abi.encodePacked(creator, name, symbol, timestamp)
        );
        return erc1155Implementation.predictDeterministicAddress(salt);
    }

    function getERC721CollectionCount() external view returns (uint256) {
        return deployedERC721Collections.length;
    }

    function getERC1155CollectionCount() external view returns (uint256) {
        return deployedERC1155Collections.length;
    }

    function getCollectionsByCreator(
        address creator
    ) external view returns (address[] memory) {
        return creatorToCollections[creator];
    }

    function setERC721Implementation(
        address newImplementation
    ) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementation();
        erc721Implementation = newImplementation;
        emit ImplementationUpdated("ERC721", newImplementation);
    }

    function setERC1155Implementation(
        address newImplementation
    ) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementation();
        erc1155Implementation = newImplementation;
        emit ImplementationUpdated("ERC1155", newImplementation);
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        creationFee = newFee;
        emit CreationFeeUpdated(newFee);
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert TransferFailed();
    }
}
