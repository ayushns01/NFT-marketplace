// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MetaTransactionHandler is EIP712, Ownable, ReentrancyGuard {
    struct MetaTransaction {
        address from;
        address to;
        uint256 value;
        bytes data;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 private constant META_TX_TYPEHASH =
        keccak256(
            "MetaTransaction(address from,address to,uint256 value,bytes data,uint256 nonce,uint256 deadline)"
        );

    mapping(address => uint256) public nonces;
    mapping(address => bool) public trustedRelayers;

    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        bool success,
        bytes returnData
    );

    event RelayerUpdated(address indexed relayer, bool trusted);

    error InvalidSignature();
    error DeadlineExpired();
    error OnlyRelayer();
    error ExecutionFailed();

    constructor() EIP712("MetaTransactionHandler", "1") Ownable(msg.sender) {
        trustedRelayers[msg.sender] = true;
    }

    function executeMetaTransaction(
        MetaTransaction calldata metaTx,
        bytes calldata signature
    ) external nonReentrant returns (bytes memory) {
        if (!trustedRelayers[msg.sender]) revert OnlyRelayer();
        if (block.timestamp > metaTx.deadline) revert DeadlineExpired();

        address signer = _verify(metaTx, signature);
        if (signer != metaTx.from) revert InvalidSignature();

        if (metaTx.nonce != nonces[metaTx.from]) revert InvalidSignature();
        nonces[metaTx.from]++;

        (bool success, bytes memory returnData) = metaTx.to.call{
            value: metaTx.value
        }(metaTx.data);

        emit MetaTransactionExecuted(
            metaTx.from,
            metaTx.to,
            success,
            returnData
        );

        if (!success) revert ExecutionFailed();

        return returnData;
    }

    function _verify(
        MetaTransaction calldata metaTx,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    META_TX_TYPEHASH,
                    metaTx.from,
                    metaTx.to,
                    metaTx.value,
                    keccak256(metaTx.data),
                    metaTx.nonce,
                    metaTx.deadline
                )
            )
        );

        return ECDSA.recover(digest, signature);
    }

    function setRelayer(address relayer, bool trusted) external onlyOwner {
        trustedRelayers[relayer] = trusted;
        emit RelayerUpdated(relayer, trusted);
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
