# Anatomy attribution

Allen Human Reference Atlas – 3D, 2020, version 1.0.0.
Allen Institute for Brain Science; Ding et al. RRID:SCR_017764.

Source and original terms:
https://download.alleninstitute.org/informatics-archive/allen_human_reference_atlas_3d_2020/version_1/README.pdf

Atlas materials: Creative Commons Attribution 4.0 International (CC BY 4.0).
License: https://creativecommons.org/licenses/by/4.0/

Adaptations in doke: explicit teaching-region unions; 1 mm resampling for overview/fine, original 0.5 mm annotations for native detail;
Gaussian/Taubin smoothing; marching-cubes meshes; quadric simplification;
RAS-derived render coordinate transform; outward winding and normal repairs;
anatomical screenshot used as the static fallback.

The manifest records source and derived hashes, original labels and omissions.
These are teaching surfaces derived from annotation data. No individual axons,
measured activation fields, or chemical concentrations are reconstructed.

Reference space: ICBM 2009b Nonlinear Symmetric. The separately licensed
reference MRI is not redistributed with doke.

Native detail applies Gaussian sigma 0.7 voxels, three Taubin iterations, and per-region face budgets. See native/manifest.json for processing and chunk hashes. Molecular structures are attributed to their PubChem compound records in molecules/*.json; these computed conformers are not dynamic simulations.
