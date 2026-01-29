// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ProtocolRegistry
 * @notice Central registry for protocol-wide emergency controls
 * @dev Provides unified pause mechanism across all marketplace contracts
 * 
 * Usage:
 * - All protocol contracts should check `isProtocolPaused()` in their modifiers
 * - Emergency pause can be triggered by EMERGENCY_ROLE (multisig recommended)
 * - Individual contracts can still be paused independently
 */
contract ProtocolRegistry is AccessControl, Pausable {
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");

    // Registered protocol contracts
    mapping(address => bool) public registeredContracts;
    address[] public contractList;

    // Protocol version for upgrade tracking
    string public protocolVersion;

    // Events
    event ContractRegistered(address indexed contractAddress, string name);
    event ContractDeregistered(address indexed contractAddress);
    event ProtocolPaused(address indexed by, string reason);
    event ProtocolUnpaused(address indexed by);
    event ProtocolVersionUpdated(string oldVersion, string newVersion);

    // Errors
    error ContractAlreadyRegistered();
    error ContractNotRegistered();
    error ZeroAddress();

    constructor(address _admin, address _emergencyMultisig) {
        if (_admin == address(0)) revert ZeroAddress();
        if (_emergencyMultisig == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(REGISTRY_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _emergencyMultisig);

        protocolVersion = "1.0.0";
    }

    /// @notice Register a protocol contract
    /// @param contractAddress The contract address to register
    /// @param name Human-readable name for logging
    function registerContract(
        address contractAddress,
        string calldata name
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        if (contractAddress == address(0)) revert ZeroAddress();
        if (registeredContracts[contractAddress]) revert ContractAlreadyRegistered();

        registeredContracts[contractAddress] = true;
        contractList.push(contractAddress);

        emit ContractRegistered(contractAddress, name);
    }

    /// @notice Deregister a protocol contract
    /// @param contractAddress The contract address to deregister
    function deregisterContract(
        address contractAddress
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        if (!registeredContracts[contractAddress]) revert ContractNotRegistered();

        registeredContracts[contractAddress] = false;
        
        // Remove from array (swap and pop)
        for (uint256 i = 0; i < contractList.length; i++) {
            if (contractList[i] == contractAddress) {
                contractList[i] = contractList[contractList.length - 1];
                contractList.pop();
                break;
            }
        }

        emit ContractDeregistered(contractAddress);
    }

    /// @notice Emergency pause the entire protocol
    /// @param reason Human-readable reason for the pause
    function emergencyPause(string calldata reason) external onlyRole(EMERGENCY_ROLE) {
        _pause();
        emit ProtocolPaused(msg.sender, reason);
    }

    /// @notice Unpause the protocol after emergency resolution
    function emergencyUnpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
        emit ProtocolUnpaused(msg.sender);
    }

    /// @notice Check if protocol is paused (for other contracts to call)
    /// @return True if protocol is paused
    function isProtocolPaused() external view returns (bool) {
        return paused();
    }

    /// @notice Get all registered contracts
    /// @return Array of registered contract addresses
    function getRegisteredContracts() external view returns (address[] memory) {
        return contractList;
    }

    /// @notice Get count of registered contracts
    /// @return Number of registered contracts
    function getContractCount() external view returns (uint256) {
        return contractList.length;
    }

    /// @notice Update protocol version
    /// @param newVersion New version string
    function setProtocolVersion(
        string calldata newVersion
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        string memory oldVersion = protocolVersion;
        protocolVersion = newVersion;
        emit ProtocolVersionUpdated(oldVersion, newVersion);
    }
}
