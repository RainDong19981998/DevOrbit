from pydicom import config, dcmread
from pydicom.dataelem import empty_value_for_VR
from pydicom.dataset import Dataset
from pydicom.filebase import DicomBytesIO
from pydicom import filewriter
from pydicom.sequence import Sequence


def roundtrip_empty_sequence(is_implicit_vr):
    dataset = Dataset()
    dataset.AcquisitionContextSequence = []
    stream = DicomBytesIO()
    stream.is_little_endian = True
    stream.is_implicit_VR = is_implicit_vr
    filewriter.write_dataset(stream, dataset)
    stream.seek(0)
    observed = dcmread(stream, force=True).AcquisitionContextSequence
    assert isinstance(observed, Sequence)
    assert observed == []


assert config.use_none_as_empty_text_VR_value is False
assert empty_value_for_VR("SQ") == []
assert empty_value_for_VR("US") is None
roundtrip_empty_sequence(True)
roundtrip_empty_sequence(False)

nested = Dataset()
nested.PatientName = "Ada"
dataset = Dataset()
dataset.AcquisitionContextSequence = [nested]
assert len(dataset.AcquisitionContextSequence) == 1
assert dataset.AcquisitionContextSequence[0].PatientName == "Ada"
print("classification: empty SQ is stable across implicit and explicit VR; controls preserved")
