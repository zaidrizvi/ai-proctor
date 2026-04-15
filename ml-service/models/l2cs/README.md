Place the pretrained L2CS-Net checkpoint here as:

`L2CSNet_gaze360.pkl`

The ML service reads this path by default:

`ml-service/models/l2cs/L2CSNet_gaze360.pkl`

You can override it with the `L2CS_WEIGHTS_PATH` environment variable.

The expected checkpoint format matches the official L2CS-Net implementation:
https://github.com/Ahmednull/L2CS-Net
