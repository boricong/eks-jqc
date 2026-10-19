$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceFile = Join-Path $taskRoot 'data\runtime\catalog-qa.xlsx'
$outputFile = Join-Path $taskRoot 'data\runtime\catalog-excel-resaved.xlsx'
$excel = $null
$book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Open($sourceFile, 0, $false)
  $originalSheetCount = $book.Worksheets.Count
  $sheet = $book.Worksheets.Item(3)
  $tableCount = $sheet.ListObjects.Count
  if ($tableCount -ne 6) { throw "Expected 6 named tables, got $tableCount" }
  $metadata = $sheet.ListObjects | Where-Object { $_.Name -like 'EKS_metadata_*' } | Select-Object -First 1
  function Set-CatalogMetadata($targetSheet, $key, $value) {
    $metaTable = $targetSheet.ListObjects | Where-Object { $_.Name -like 'EKS_metadata_*' } | Select-Object -First 1
    $keyIndex = $metaTable.ListColumns.Item('관리 코드').Index
    foreach ($row in $metaTable.ListRows) { if ($row.Range.Cells.Item(1,$keyIndex).Value2 -eq $key) { $row.Range.Cells.Item(1,2).Value2 = $value; return } }
    throw "Metadata key missing: $key"
  }
  $learning = $sheet.ListObjects | Where-Object { $_.Name -like 'EKS_learning_*' } | Select-Object -First 1
  $originalRows = $learning.ListRows.Count
  $validationType = $learning.ListRows.Item(1).Range.Cells.Item(1,$learning.ListColumns.Item('교육 종류').Index).Validation.Type
  $courseValidationType = $learning.ListRows.Item(1).Range.Cells.Item(1,$learning.ListColumns.Item('과정 선택').Index).Validation.Type
  $newRow = $learning.ListRows.Add([Type]::Missing, $true)
  $newRow.Range.Value2 = $learning.ListRows.Item(1).Range.Value2
  $newRow.Range.Cells.Item(1,$learning.ListColumns.Item('관리 코드').Index).Value2 = ''
  $newRow.Range.Cells.Item(1,$learning.ListColumns.Item('항목명').Index).Value2 = 'Excel에서 추가한 학습 항목'
  $newRow.Range.Cells.Item(1,$learning.ListColumns.Item('순서').Index).Value2 = 99
  $learning.Sort.SortFields.Clear()
  [void]$learning.Sort.SortFields.Add($learning.ListColumns.Item('순서').Range,0,2)
  $learning.Sort.Header = 1
  $learning.Sort.Apply()
  $sheet.Copy([Type]::Missing, $book.Worksheets.Item($book.Worksheets.Count))
  $copy = $book.Worksheets.Item($book.Worksheets.Count)
  $copy.Name = 'Excel 복제 신규자격'
  Set-CatalogMetadata $copy 'mode' '새 자격'
  Set-CatalogMetadata $copy 'code' ''
  Set-CatalogMetadata $copy 'title' 'Excel 복제 신규 자격'
  $book.SaveAs($outputFile,51)
  $report = @{excelVersion=$excel.Version; format='v2'; originalSheets=$originalSheetCount; savedSheets=$book.Worksheets.Count; namedTables=$tableCount; dropdownValidationType=$validationType; courseDropdownValidationType=$courseValidationType; learningRowsBefore=$originalRows; learningRowsAfter=$learning.ListRows.Count; openedNormally=$true; output=$outputFile}
  $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'data\runtime\catalog-native-excel-com.json') -Encoding utf8
  $report | ConvertTo-Json
} finally {
  if ($book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
  if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
