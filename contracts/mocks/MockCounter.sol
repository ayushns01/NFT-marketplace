// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Simple counter contract for testing meta-transactions
contract MockCounter {
    uint256 public count;

    event Incremented(address indexed caller, uint256 newCount);

    function increment() external returns (uint256) {
        count += 1;
        emit Incremented(msg.sender, count);
        return count;
    }

    function incrementBy(uint256 amount) external returns (uint256) {
        count += amount;
        emit Incremented(msg.sender, count);
        return count;
    }

    function getCount() external view returns (uint256) {
        return count;
    }
}
