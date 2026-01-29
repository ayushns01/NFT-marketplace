// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FractionalVault is ReentrancyGuard {
    enum VaultState {
        Active,
        Bought,
        Redeemed
    }

    struct Vault {
        address nftContract;
        uint256 tokenId;
        address curator;
        address shareToken;
        uint256 totalShares;
        uint256 reservePrice;
        uint256 buyoutPrice; // NEW: Store actual buyout amount for pro-rata claims
        VaultState state;
        uint256 createdAt;
    }

    uint256 private _vaultIdCounter;
    mapping(uint256 => Vault) public vaults;
    mapping(bytes32 => uint256) public nftToVault; // keccak256(nftContract, tokenId) => vaultId
    mapping(uint256 => uint256) public claimedShares; // NEW: Track claimed shares per vault
    mapping(uint256 => uint256) public vaultBalances; // NEW: Track ETH balance per vault

    event VaultCreated(
        uint256 indexed vaultId,
        address indexed curator,
        address indexed nftContract,
        uint256 tokenId,
        address shareToken,
        uint256 totalShares
    );

    event BuyoutInitiated(
        uint256 indexed vaultId,
        address indexed buyer,
        uint256 price
    );
    event VaultRedeemed(uint256 indexed vaultId, address indexed redeemer);
    event ReservePriceUpdated(uint256 indexed vaultId, uint256 newPrice);
    event ProceedsClaimed(// NEW: Event for transparency


        uint256 indexed vaultId,
        address indexed shareholder,
        uint256 shares,
        uint256 amount
    );
    event DustWithdrawn(
        uint256 indexed vaultId,
        address indexed curator,
        uint256 amount
    );

    error VaultNotActive();
    error VaultNotBought(); // NEW: For claimProceeds
    error InsufficientPayment();
    error NotCurator();
    error NFTAlreadyVaulted();
    error InvalidShares();
    error TransferFailed();
    error NotAllSharesOwned();
    error NothingToClaim(); // NEW: For claimProceeds

    function fractionalize(
        address nftContract,
        uint256 tokenId,
        uint256 totalShares,
        uint256 reservePrice,
        string memory shareName,
        string memory shareSymbol
    ) external nonReentrant returns (uint256) {
        if (totalShares == 0) revert InvalidShares();
        bytes32 nftKey = keccak256(abi.encode(nftContract, tokenId));
        if (nftToVault[nftKey] != 0) revert NFTAlreadyVaulted();

        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        ShareToken shareToken = new ShareToken(
            shareName,
            shareSymbol,
            totalShares,
            msg.sender
        );

        uint256 vaultId = _vaultIdCounter++;

        vaults[vaultId] = Vault({
            nftContract: nftContract,
            tokenId: tokenId,
            curator: msg.sender,
            shareToken: address(shareToken),
            totalShares: totalShares,
            reservePrice: reservePrice,
            buyoutPrice: 0, // NEW: Initialize to 0
            state: VaultState.Active,
            createdAt: block.timestamp
        });

        nftToVault[nftKey] = vaultId;

        emit VaultCreated(
            vaultId,
            msg.sender,
            nftContract,
            tokenId,
            address(shareToken),
            totalShares
        );

        return vaultId;
    }

    function buyout(uint256 vaultId) external payable nonReentrant {
        Vault storage vault = vaults[vaultId];

        if (vault.state != VaultState.Active) revert VaultNotActive();
        if (msg.value < vault.reservePrice) revert InsufficientPayment();

        // CEI Pattern: Update state BEFORE external calls
        vault.state = VaultState.Bought;
        vault.buyoutPrice = msg.value;
        vaultBalances[vaultId] = msg.value; // Track ETH for this specific vault

        // Cache values before external call
        address nftContract = vault.nftContract;
        uint256 tokenId = vault.tokenId;

        // Emit event before external call
        emit BuyoutInitiated(vaultId, msg.sender, msg.value);

        // External call last (Checks-Effects-Interactions)
        IERC721(nftContract).transferFrom(
            address(this),
            msg.sender,
            tokenId
        );
    }

    /// @notice Claim pro-rata share of buyout proceeds
    /// @param vaultId The vault ID to claim from
    /// @dev Burns caller's share tokens and transfers proportional ETH
    function claimProceeds(uint256 vaultId) external nonReentrant {
        Vault storage vault = vaults[vaultId];

        if (vault.state != VaultState.Bought) revert VaultNotBought();

        ShareToken shareToken = ShareToken(vault.shareToken);
        uint256 userShares = shareToken.balanceOf(msg.sender);

        if (userShares == 0) revert NothingToClaim();

        // Calculate pro-rata payment
        uint256 payment = (userShares * vault.buyoutPrice) / vault.totalShares;

        // Burn shares before transfer (CEI pattern)
        shareToken.burnFrom(msg.sender, userShares);
        claimedShares[vaultId] += userShares;
        vaultBalances[vaultId] -= payment; // Deduct from vault-specific balance

        // Transfer ETH
        (bool success, ) = payable(msg.sender).call{value: payment}("");
        if (!success) revert TransferFailed();

        emit ProceedsClaimed(vaultId, msg.sender, userShares, payment);
    }

    function redeem(uint256 vaultId) external nonReentrant {
        Vault storage vault = vaults[vaultId];

        if (vault.state != VaultState.Active) revert VaultNotActive();

        ShareToken shareToken = ShareToken(vault.shareToken);
        uint256 userShares = shareToken.balanceOf(msg.sender);

        if (userShares != vault.totalShares) revert NotAllSharesOwned();

        vault.state = VaultState.Redeemed;

        shareToken.burnFrom(msg.sender, vault.totalShares);

        IERC721(vault.nftContract).transferFrom(
            address(this),
            msg.sender,
            vault.tokenId
        );

        emit VaultRedeemed(vaultId, msg.sender);
    }

    function updateReservePrice(uint256 vaultId, uint256 newPrice) external {
        Vault storage vault = vaults[vaultId];

        if (msg.sender != vault.curator) revert NotCurator();
        if (vault.state != VaultState.Active) revert VaultNotActive();

        vault.reservePrice = newPrice;

        emit ReservePriceUpdated(vaultId, newPrice);
    }

    function getVault(uint256 vaultId) external view returns (Vault memory) {
        return vaults[vaultId];
    }

    function getTotalVaults() external view returns (uint256) {
        return _vaultIdCounter;
    }

    /// @notice Get claimable amount for a shareholder
    /// @param vaultId The vault ID
    /// @param shareholder The address to check
    /// @return The amount of ETH claimable
    function getClaimableAmount(
        uint256 vaultId,
        address shareholder
    ) external view returns (uint256) {
        Vault storage vault = vaults[vaultId];
        if (vault.state != VaultState.Bought) return 0;

        ShareToken shareToken = ShareToken(vault.shareToken);
        uint256 userShares = shareToken.balanceOf(shareholder);

        return (userShares * vault.buyoutPrice) / vault.totalShares;
    }

    /// @notice Withdraw rounding dust after all shares have been claimed
    /// @param vaultId The vault ID
    /// @dev Only callable by curator after all shares are claimed
    function withdrawDust(uint256 vaultId) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        if (msg.sender != vault.curator) revert NotCurator();
        if (vault.state != VaultState.Bought) revert VaultNotBought();

        ShareToken shareToken = ShareToken(vault.shareToken);
        if (shareToken.totalSupply() != 0) revert NothingToClaim();

        // Use per-vault balance tracking instead of contract balance
        uint256 dust = vaultBalances[vaultId];
        if (dust == 0) revert NothingToClaim();

        vaultBalances[vaultId] = 0;

        (bool success, ) = payable(msg.sender).call{value: dust}("");
        if (!success) revert TransferFailed();

        emit DustWithdrawn(vaultId, msg.sender, dust);
    }
}

contract ShareToken is ERC20 {
    address public immutable vault;
    
    // Track approvals specifically for vault burning
    mapping(address => bool) public approvedForVaultBurn;

    error NotApprovedForVaultBurn();
    error OnlyVault();

    event VaultBurnApproval(address indexed owner, bool approved);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address recipient
    ) ERC20(name_, symbol_) {
        vault = msg.sender;
        _mint(recipient, totalSupply_);
    }

    /// @notice Approve the vault to burn your shares (required before claimProceeds)
    /// @param approved Whether to approve or revoke approval
    function approveVaultBurn(bool approved) external {
        approvedForVaultBurn[msg.sender] = approved;
        emit VaultBurnApproval(msg.sender, approved);
    }

    /// @notice Burn shares from an account (vault only, requires user approval)
    /// @dev User must call approveVaultBurn(true) before vault can burn their shares
    function burnFrom(address account, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        if (!approvedForVaultBurn[account]) revert NotApprovedForVaultBurn();
        _burn(account, amount);
    }
}
