// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title PaymentSplitter
 * @notice Shared library for fee and royalty distribution
 * @dev Eliminates code duplication across Marketplace, AuctionEngine, etc.
 */
library PaymentSplitter {
    using SafeERC20 for IERC20;

    struct PaymentConfig {
        address feeRecipient;
        uint256 platformFeeBps; // Basis points (e.g., 250 = 2.5%)
    }

    struct PaymentResult {
        uint256 platformAmount;
        uint256 royaltyAmount;
        uint256 sellerAmount;
        address royaltyRecipient;
    }

    error TransferFailed();

    /// @notice Calculate payment distribution
    /// @param nftContract The NFT contract (for royalty lookup)
    /// @param tokenId The token ID
    /// @param price Total sale price
    /// @param config Fee configuration
    function calculateDistribution(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        PaymentConfig memory config
    ) internal view returns (PaymentResult memory result) {
        result.platformAmount = (price * config.platformFeeBps) / 10000;

        // Try EIP-2981 royalty lookup
        try IERC2981(nftContract).royaltyInfo(tokenId, price) returns (
            address receiver,
            uint256 amount
        ) {
            result.royaltyRecipient = receiver;
            result.royaltyAmount = amount;
        } catch {
            result.royaltyRecipient = address(0);
            result.royaltyAmount = 0;
        }
        result.sellerAmount =
            price -
            result.platformAmount -
            result.royaltyAmount;
    }

    /// @notice Distribute ETH payments
    /// @param seller The seller to pay
    /// @param result Payment distribution result
    /// @param config Fee configuration
    function distributeETH(
        address seller,
        PaymentResult memory result,
        PaymentConfig memory config
    ) internal {
        if (result.platformAmount > 0) {
            (bool feeSuccess, ) = payable(config.feeRecipient).call{
                value: result.platformAmount
            }("");
            if (!feeSuccess) revert TransferFailed();
        }

        if (result.royaltyAmount > 0 && result.royaltyRecipient != address(0)) {
            (bool royaltySuccess, ) = payable(result.royaltyRecipient).call{
                value: result.royaltyAmount
            }("");
            if (!royaltySuccess) revert TransferFailed();
        }

        (bool sellerSuccess, ) = payable(seller).call{
            value: result.sellerAmount
        }("");
        if (!sellerSuccess) revert TransferFailed();
    }

    /// @notice Distribute ERC20 payments
    /// @param token The ERC20 token
    /// @param payer The address paying
    /// @param seller The seller to pay
    /// @param result Payment distribution result
    /// @param config Fee configuration
    function distributeERC20(
        IERC20 token,
        address payer,
        address seller,
        PaymentResult memory result,
        PaymentConfig memory config
    ) internal {
        if (result.platformAmount > 0) {
            token.safeTransferFrom(
                payer,
                config.feeRecipient,
                result.platformAmount
            );
        }

        if (result.royaltyAmount > 0 && result.royaltyRecipient != address(0)) {
            token.safeTransferFrom(
                payer,
                result.royaltyRecipient,
                result.royaltyAmount
            );
        }

        token.safeTransferFrom(payer, seller, result.sellerAmount);
    }
}
