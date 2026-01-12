// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
        VaultState state;
        uint256 createdAt;
    }

    uint256 private _vaultIdCounter;
    mapping(uint256 => Vault) public vaults;
    mapping(address => uint256) public nftToVault;

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

    error VaultNotActive();
    error InsufficientPayment();
    error NotCurator();
    error NFTAlreadyVaulted();
    error InvalidShares();
    error TransferFailed();
    error NotAllSharesOwned();

    function fractionalize(
        address nftContract,
        uint256 tokenId,
        uint256 totalShares,
        uint256 reservePrice,
        string memory shareName,
        string memory shareSymbol
    ) external nonReentrant returns (uint256) {
        if (totalShares == 0) revert InvalidShares();
        if (nftToVault[nftContract] != 0) revert NFTAlreadyVaulted();

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
            state: VaultState.Active,
            createdAt: block.timestamp
        });

        nftToVault[nftContract] = vaultId;

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

        vault.state = VaultState.Bought;

        IERC721(vault.nftContract).transferFrom(
            address(this),
            msg.sender,
            vault.tokenId
        );

        emit BuyoutInitiated(vaultId, msg.sender, msg.value);
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
}

contract ShareToken is ERC20 {
    address public vault;

    constructor(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        address recipient
    ) ERC20(name, symbol) {
        vault = msg.sender;
        _mint(recipient, totalSupply);
    }

    function burnFrom(address account, uint256 amount) external {
        require(msg.sender == vault, "Only vault");
        _burn(account, amount);
    }
}
