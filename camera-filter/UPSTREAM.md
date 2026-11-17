# TypeSub Virtual Camera filter

Derived from Unity Capture by Bernhard Schelling (2018) and UnityCam by
MHD Yamen Saraiji (2016), upstream commit
`3ed54c325e0ad71afcf4f246c07e5e17b3d7f2d2`.

The filter is distributed under the MIT license. The original copyright and
license notice remain in `UnityCaptureFilter.cpp`. TypeSub changes the COM
class identifiers, device name, and shared-memory namespace to avoid
interfering with another Unity Capture installation. The filter is built with
MSVC v143; the binary is unsigned. A code-signing certificate is required
before the PRD's Authenticode requirement can be claimed as complete.

TypeSub renders its own caption frames and sends them to this filter. OBS is a
consumer of the camera device, not the source of the captured picture.
